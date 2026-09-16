"""Split oversized reading documents into chapter-sized files.

The mobile reader renders one spine document at a time as a single
multi-column layout. A document the size of a whole volume (the Wikisource
export of «Война и мир» ships one file per volume, 1.5 MB each) makes every
page turn, font change and annotation pass proportionally slow. Splitting the
file at its chapter headings gives the reader documents the size of a normal
chapter and gives the table of contents the chapters it was missing.

Element IDs are retained, so links into a split document are redirected to the
part that now holds their target. The first part keeps the original file name
and manifest ID, so fragment-less links and existing navigation entries stay
valid without rewriting.
"""
import copy
import posixpath
import re
from urllib.parse import quote, unquote

from lxml import etree as ET

XHTML = 'http://www.w3.org/1999/xhtml'
OPF = 'http://www.idpf.org/2007/opf'

# Body text (characters without markup) above which a document is split. Set so
# that only volume-sized documents qualify («Война и мир» ships one file per
# volume, 470-800 thousand characters each); ordinary long chapters stay whole.
MAX_DOCUMENT_CHARS = 400_000
# A heading only starts a new part once this much text has accumulated since the
# previous split, so a part title directly followed by its first chapter heading
# stays together with that chapter instead of becoming a near-empty document.
MIN_PART_CHARS = 5_000
HEADING_TAGS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}
HEADER_CLASS = re.compile(r'(?:^|\s)header([1-6])(?:\s|$)')
EXTERNAL = re.compile(r'^[a-z][a-z0-9+.-]*:', re.I)


def local(el):
    return ET.QName(el).localname if isinstance(el.tag, str) else ''


def text_of(el):
    return ' '.join(''.join(el.itertext()).split())


def heading_level(el):
    """Return the heading level of an element, or None when it is not a heading."""
    if not isinstance(el.tag, str): return None
    name = local(el)
    if name in HEADING_TAGS: return int(name[1])
    if el.get('role') == 'heading':
        level = el.get('aria-level', '')
        return int(level) if level.isdigit() else 2
    if el.get('data-narra-heading') == 'true': return 2
    match = HEADER_CLASS.search(el.get('class', ''))
    if match: return int(match.group(1))
    return None


def text_positions(body):
    """Map every element under body to the number of text characters before it."""
    positions = {}
    total = 0
    def walk(el):
        nonlocal total
        positions[el] = total
        if not isinstance(el.tag, str): return
        total += len(el.text or '')
        for child in el:
            walk(child)
            total += len(child.tail or '')
    walk(body)
    return positions, total


def choose_boundaries(body, min_part_chars=MIN_PART_CHARS):
    """Pick the headings that start new parts. Returns (boundaries, total_chars, headings)."""
    positions, total = text_positions(body)
    headings = [el for el in body.iter() if el is not body and heading_level(el) is not None]
    boundaries = []
    last = 0
    for heading in headings:
        if positions[heading] - last >= min_part_chars:
            boundaries.append(heading)
            last = positions[heading]
    # A tiny trailing part (a closing note after the last heading) rides with
    # the previous chapter rather than becoming a document of its own.
    if boundaries and total - positions[boundaries[-1]] < min_part_chars:
        boundaries.pop()
    return boundaries, total, headings


def extract_part(doc, start, end):
    """Copy `doc` keeping only the body content from `start` (inclusive) to `end` (exclusive).

    `start`/`end` are elements of `doc` in document order, or None for the body
    start / body end. Ancestors of the range are kept so the part preserves the
    original nesting; text and siblings outside the range are dropped.
    """
    originals = list(doc.iter())
    part = copy.deepcopy(doc)
    copies = list(part.iter())
    index = {el: i for i, el in enumerate(originals)}
    body_index = index[next(iter(doc.xpath('//*[local-name()="body"]')))]
    start_index = index[start] if start is not None else body_index
    end_index = index[end] if end is not None else len(originals)
    start_ancestors = {index[a] for a in start.iterancestors()} if start is not None else set()
    end_ancestors = {index[a] for a in end.iterancestors()} if end is not None else set()
    removed = set()
    for i, el in enumerate(copies):
        if i <= body_index: continue
        parent = el.getparent()
        if parent is None or parent in removed:
            removed.add(el)
            continue
        if i < start_index:
            if i in start_ancestors:
                el.text = None
            else:
                parent.remove(el)
                removed.add(el)
        elif i >= end_index:
            parent.remove(el)
            removed.add(el)
    if start is not None:
        copies[body_index].text = None
    # Text following an ancestor of `end` comes after content that moved to the next part.
    for i in end_ancestors:
        if i > body_index and copies[i] not in removed:
            copies[i].tail = None
    # Wrappers that only held content now moved to the next part are empty.
    for i in sorted(end_ancestors, reverse=True):
        el = copies[i]
        if i <= body_index or el in removed or el.getparent() is None: continue
        if len(el) == 0 and not (el.text or '').strip():
            el.getparent().remove(el)
            removed.add(el)
    return part


def part_name(name, number, taken):
    stem, ext = posixpath.splitext(name)
    candidate = f'{stem}-{number:03d}{ext}'
    while candidate in taken:
        number += 1
        candidate = f'{stem}-{number:03d}{ext}'
    return candidate


def relative_href(from_document, to_document, fragment=''):
    if from_document == to_document and fragment: return f'#{fragment}'
    href = quote(posixpath.relpath(to_document, posixpath.dirname(from_document) or '.'), safe='/-_.~')
    return f'{href}#{fragment}' if fragment else href


def split_large_documents(docs, ncxs, manifest, opf, opf_name, excluded, report, member_path,
                          max_chars=MAX_DOCUMENT_CHARS, min_part_chars=MIN_PART_CHARS):
    """Split every linear reading document above `max_chars` at its headings.

    Mutates `docs` (adds the new part documents), the OPF manifest and spine,
    the navigation document(s) and NCX, and rewrites links whose targets moved.
    Returns the split reports, also stored under report['split_documents'].
    """
    splits = report.setdefault('split_documents', [])
    manifest_el = opf.xpath('//*[local-name()="manifest"]')[0]
    spine = opf.xpath('//*[local-name()="spine"]')[0]
    nav_names = {name for name, item in manifest.values() if 'nav' in item.get('properties', '').split()}
    linear_names = []
    for ref in spine:
        if not isinstance(ref.tag, str): continue
        entry = manifest.get(ref.get('idref'))
        if entry and ref.get('linear') != 'no': linear_names.append(entry[0])

    origin_of = {}   # part document -> original document
    located = {}     # (original document, element id) -> part document holding it
    outlines = {}    # original document -> [(level, label, part document, fragment)]
    for name in linear_names:
        if name not in docs or name in excluded or name in nav_names: continue
        doc = docs[name]
        body = next(iter(doc.xpath('//*[local-name()="body"]')), None)
        if body is None: continue
        total = len(''.join(body.itertext()))
        if total <= max_chars: continue
        boundaries, _, headings = choose_boundaries(body, min_part_chars)
        if not boundaries:
            report.setdefault('warnings', []).append(f'Oversized document without headings to split at: {name}')
            continue
        # Every heading gets an ID so the table of contents can point at it.
        used_ids = set(doc.xpath('//@id'))
        for number, heading in enumerate(headings, 1):
            if heading.get('id'): continue
            candidate = f'narra-heading-{number}'
            while candidate in used_ids: candidate += '-'
            heading.set('id', candidate); used_ids.add(candidate)
        boundary_part = {heading: number for number, heading in enumerate(boundaries, 1)}
        edges = [None] + boundaries + [None]
        parts = [extract_part(doc, edges[i], edges[i + 1]) for i in range(len(edges) - 1)]

        original_item = next(item for item_name, item in manifest.values() if item_name == name)
        original_ref = next(ref for ref in spine if isinstance(ref.tag, str)
                            and manifest.get(ref.get('idref'), (None,))[0] == name)
        taken = set(docs) | {item_name for item_name, _ in manifest.values()}
        names = [name]
        for number in range(1, len(parts)):
            new_name = part_name(name, number, taken)
            taken.add(new_name); names.append(new_name)

        outline = []
        current = 0
        for heading in headings:
            current = boundary_part.get(heading, current)
            outline.append((heading_level(heading), text_of(heading), names[current], heading.get('id')))
        outlines[name] = outline

        previous_item, previous_ref = original_item, original_ref
        for number, part in enumerate(parts):
            part_doc = names[number]
            origin_of[part_doc] = name
            # Ancestor wrappers repeat in every part; a link to one leads to the first.
            for id_value in part.xpath('//*[local-name()="body"]//@id'):
                located.setdefault((name, id_value), part_doc)
            docs[part_doc] = part
            if number == 0: continue
            first_label = next((label for _, label, doc_name, _ in outline if doc_name == part_doc and label), None)
            if first_label:
                for title in part.xpath('//*[local-name()="head"]/*[local-name()="title"]'):
                    title.text = first_label
            item = ET.Element(f'{{{OPF}}}item')
            item_id = f"{original_item.get('id')}-{number:03d}"
            while item_id in manifest: item_id += '-'
            item.set('id', item_id)
            item.set('href', relative_href(opf_name, part_doc))
            item.set('media-type', original_item.get('media-type'))
            previous_item.addnext(item); previous_item = item
            manifest[item.get('id')] = (part_doc, item)
            ref = ET.Element(f'{{{OPF}}}itemref')
            ref.set('idref', item_id)
            if original_ref.get('linear'): ref.set('linear', original_ref.get('linear'))
            previous_ref.addnext(ref); previous_ref = ref
        splits.append({'document': name, 'parts': len(parts), 'characters': total, 'headings': len(outline)})

    if not outlines: return splits

    # Redirect links whose target element now lives in another part.
    def redirect(document, href):
        if not href or EXTERNAL.match(href): return None
        path, _, fragment = href.partition('#')
        if not fragment: return None
        target = member_path(document, path) if path else document
        holder = located.get((origin_of.get(target, target), unquote(fragment)))
        if not holder or holder == target: return None
        return relative_href(document, holder, fragment)
    for doc_name, doc in docs.items():
        for anchor in doc.xpath('//*[@href]'):
            new_href = redirect(doc_name, anchor.get('href'))
            if new_href: anchor.set('href', new_href)
    for ncx_name, ncx in ncxs.items():
        for content in ncx.xpath('//*[local-name()="content"][@src]'):
            new_href = redirect(ncx_name, content.get('src'))
            if new_href: content.set('src', new_href)

    # Nest the chapters under each split document's navigation entry.
    for nav_name in nav_names:
        nav = docs.get(nav_name)
        if nav is None: continue
        toc = next(iter(nav.xpath('//*[local-name()="nav"][@*[local-name()="type"]="toc"]')), None)
        if toc is None: toc = next(iter(nav.xpath('//*[local-name()="nav"]')), None)
        if toc is None: continue
        for name, outline in outlines.items():
            anchors = [a for a in toc.xpath('.//*[local-name()="a"][@href]')
                       if not a.get('href').partition('#')[2]
                       and member_path(nav_name, a.get('href')) == name]
            if not anchors: continue
            li = anchors[0].getparent()
            if local(li) != 'li' or li.xpath('./*[local-name()="ol"]'): continue
            entries = [entry for entry in outline if entry[1]]
            if entries: append_nested_list(li, entries, nav_name)
    for ncx_name, ncx in ncxs.items():
        nav_map = next(iter(ncx.xpath('//*[local-name()="navMap"]')), None)
        if nav_map is None: continue
        ns = ET.QName(nav_map).namespace
        tag = (lambda n: f'{{{ns}}}{n}') if ns else (lambda n: n)
        for name, outline in outlines.items():
            points = [p for p in nav_map.xpath('.//*[local-name()="navPoint"]')
                      if any(not c.get('src', '').partition('#')[2]
                             and member_path(ncx_name, c.get('src', '')) == name
                             for c in p.xpath('./*[local-name()="content"]'))]
            if not points or points[0].xpath('./*[local-name()="navPoint"]'): continue
            parent = points[0]
            for number, (level, label, doc_name, fragment) in enumerate(outline, 1):
                if not label: continue
                point = ET.SubElement(parent, tag('navPoint'))
                point.set('id', f"{parent.get('id') or 'part'}-{number}")
                ET.SubElement(ET.SubElement(point, tag('navLabel')), tag('text')).text = label
                ET.SubElement(point, tag('content')).set('src', relative_href(ncx_name, doc_name, fragment))
        for order, point in enumerate(ncx.xpath('//*[local-name()="navPoint"]'), 1):
            point.set('playOrder', str(order))
        depth = max((1 + sum(1 for a in p.iterancestors() if local(a) == 'navPoint')
                     for p in ncx.xpath('//*[local-name()="navPoint"]')), default=1)
        for meta in ncx.xpath('//*[local-name()="meta"][@name="dtb:depth"]'):
            meta.set('content', str(depth))
    return splits


def append_nested_list(li, entries, nav_name):
    """Append `entries` as a nested <ol> under `li`, nesting deeper heading levels."""
    root_list = ET.SubElement(li, f'{{{XHTML}}}ol')
    stack = [(entries[0][0], root_list)]
    for level, label, doc_name, fragment in entries:
        while len(stack) > 1 and level < stack[-1][0]: stack.pop()
        if level > stack[-1][0] and len(stack[-1][1]):
            last_item = stack[-1][1][-1]
            nested = last_item.find(f'{{{XHTML}}}ol')
            stack.append((level, nested if nested is not None else ET.SubElement(last_item, f'{{{XHTML}}}ol')))
        item = ET.SubElement(stack[-1][1], f'{{{XHTML}}}li')
        link = ET.SubElement(item, f'{{{XHTML}}}a')
        link.set('href', relative_href(nav_name, doc_name, fragment))
        # Same inline style chapter_headings applies to navigation labels, so a
        # second cleanup pass finds nothing to change.
        link.set('style', 'text-transform:none!important;font-variant:normal!important')
        link.text = label
