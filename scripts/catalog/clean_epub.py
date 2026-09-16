#!/usr/bin/env python3
"""Clean catalog EPUBs into a separate directory; never overwrite the input.

Requires lxml. Source identifiers, chapter file names and element IDs are retained.
License/source documents stay in the archive, outside the reading order and TOC.
"""
import argparse
import hashlib
import html
import json
import posixpath
import re
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote
from lxml import etree as ET
from lxml import html as HTML
from chapter_headings import normalize_chapters
from repair_navigation import recover_navigation, remove_contents_column_labels
from split_documents import split_large_documents

XHTML = 'http://www.w3.org/1999/xhtml'
OPF = 'http://www.idpf.org/2007/opf'
DC = 'http://purl.org/dc/elements/1.1/'
EPUB = 'http://www.idpf.org/2007/ops'
XML = 'http://www.w3.org/XML/1998/namespace'
EDITORIAL = re.compile(r'^(?:the\s+)?(?:примечания (?:редакторов(?: викитеки)?|издателя)|литературный комментарий|предисловие (?:редактора|издателя)|(?:editor|translator|publisher)s?[’\']?s? (?:preface|notes|note|introduction)|transcriber[’\']?s notes|editorial notes|note to this edition)\s*[:.]?$', re.I)
NOTICE_CLASSES = {'publisher', 'tppublisher', 'copyright', 'transcriberNote', 'transcribernote', 'colophonMetadata', 'advertisements'}
NOTICE_IDS = {'pg-header', 'pg-footer', 'adverts'}
CHROME = {'headertemplate', 'sub_nav', 'mw-editsection', 'noprint', 'ws-noexport', 'ws-export-ignore', 'catlinks', 'printfooter', 'navbox', 'sistersitebox', 'ws-noinclude'}
REMOVE_TAGS = {'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'}

def local(el):
    return ET.QName(el).localname if isinstance(el.tag, str) else ''

def text(el):
    return ' '.join(''.join(el.itertext()).split())

def normalized(value):
    return ' '.join(html.unescape(re.sub(r'</?(?:a|p|span|div|b|i|em|strong|br|h[1-6])(?:\s[^>]*)?/?>', '', value, flags=re.I)).replace('\u200b', '').split())

def parse(data):
    return ET.fromstring(data, ET.XMLParser(resolve_entities=False, no_network=True, recover=False))

class DataText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
    def handle_data(self, value): self.parts.append(value)

def read_document(data, report, name):
    try: return parse(data)
    except ET.XMLSyntaxError:
        original = data.decode('utf-8-sig')
        if name.lower().endswith('.ncx'):
            # Earlier cleanup left unmatched closing navPoint tags. Remove only
            # these unmatched delimiters, retaining every label and destination.
            depth = 0
            def balance(match):
                nonlocal depth
                token = match.group(0)
                if token.startswith('</'):
                    if depth == 0: return ''
                    depth -= 1
                elif not token.endswith('/>'): depth += 1
                return token
            repaired = re.sub(r'</?(?:[\w.-]+:)?navPoint\b[^>]*>', balance, original)
            try: doc = parse(repaired.encode('utf-8'))
            except ET.XMLSyntaxError:
                doc = ET.fromstring(data, ET.XMLParser(resolve_entities=False, no_network=True, recover=True))
        else:
            doc = ET.fromstring(data, ET.XMLParser(resolve_entities=False, no_network=True, recover=True))
        before = DataText(); before.feed(original)
        expected_text = ' '.join(''.join(before.parts).split())
        if (doc is None or expected_text != text(doc)) and name.lower().endswith(('.html', '.xhtml', '.htm')):
            recovered = HTML.document_fromstring(data, parser=HTML.HTMLParser(no_network=True))
            doc = parse(serialize(recovered))
        if doc is None or expected_text != text(doc):
            raise ValueError(f'{name}: XML repair would lose text')
        original_ids = re.findall(r'(?<![\w:-])id\s*=\s*["\']([^"\']*)["\']', original)
        if sorted(html.unescape(value) for value in original_ids) != sorted(el.get('id') for el in doc.iter() if el.get('id') is not None):
            raise ValueError(f'{name}: XML repair would lose element IDs')
        report.setdefault('repaired_xml', []).append(name)
        return doc

def serialize(doc):
    return ET.tostring(doc, xml_declaration=True, encoding='UTF-8')

def discard(el):
    parent = el.getparent()
    if parent is None: return
    # Keep whitespace/punctuation after a removed marker or editorial block.
    if el.tail:
        previous = el.getprevious()
        if previous is None: parent.text = (parent.text or '') + el.tail
        else: previous.tail = (previous.tail or '') + el.tail
    parent.remove(el)

def external(href):
    value = html.unescape(href).strip()
    return bool(re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', value)) or value.startswith('//')

def neutralize_link(element):
    namespace = ET.QName(element).namespace
    element.tag = f'{{{namespace}}}span' if namespace else 'span'
    for key in ('href', 'target', 'rel', 'title', 'class'): element.attrib.pop(key, None)

def member_path(document, href):
    target = unquote(href.split('#')[0])
    return posixpath.normpath(posixpath.join(posixpath.dirname(document), target)) if target else document

def clean_literal_markup(value):
    if not value: return value
    # These are escaped export tags displayed as prose, not actual EPUB elements.
    value = re.sub(r'<{1,2}br\s*/?>', '\n', value, flags=re.I)
    return re.sub(r'</?(?:span|div|a|p|b|i|em|strong)(?:\s[^>]*)?>', '', value, flags=re.I)

def clean_split_literal_markup(body, report):
    # Some exports wrap each word of an escaped tag in separate real spans.
    # Remove only its character ranges; do not flatten the paragraph or its IDs.
    nodes = []
    offset = 0
    for element in body.iter():
        if not isinstance(element.tag, str): continue
        for field in ('text', 'tail'):
            value = getattr(element, field)
            if value:
                nodes.append((element, field, value, offset, offset + len(value)))
                offset += len(value)
    joined = ''.join(node[2] for node in nodes)
    matches = list(re.finditer(r'<{1,2}/?(?:span|div|br|a|p|b|i|em|strong)(?:\s[^>]*)?/?>', joined, re.I))
    if not matches: return
    for element, field, value, start, end in nodes:
        for match in reversed(matches):
            if match.start() >= end or match.end() <= start: continue
            left, right = max(0, match.start()-start), min(len(value), match.end()-start)
            replacement = '\n' if match.start() >= start and re.match(r'<{1,2}br\b', match.group(), re.I) else ''
            value = value[:left] + replacement + value[right:]
        setattr(element, field, value)
    report['split_markup_tags_cleaned'] = report.get('split_markup_tags_cleaned', 0) + len(matches)

def clean_document(doc, report, editorial_headings=(), reviewed_sections=(), text_replacements=None, normalize_image_floats=False):
    body = next(iter(doc.xpath('//*[local-name()="body"]')), None)
    if body is None: return
    # Remove explicit source-site UI and note blocks before removing link behavior.
    for el in list(doc.iter()):
        if not isinstance(el.tag, str) or el is body or not any(parent is doc for parent in el.iterancestors()): continue
        classes = set(el.get('class', '').split())
        ident = el.get('id', '')
        if classes & NOTICE_CLASSES or ident in NOTICE_IDS:
            if text(el):
                report.setdefault('_notices', []).append(text(el))
                report['_notices'].extend(a.get('href') for a in el.xpath('.//*[local-name()="a"][@href]') if external(a.get('href')))
            report['removed_blocks'] += 1
            discard(el)
            continue
        if (local(el) in REMOVE_TAGS or classes & CHROME or ident in CHROME):
            report['removed_blocks'] += 1; discard(el)
    # Source-only paragraphs are export credits, not part of the prose.
    for paragraph in list(body.xpath('.//*[local-name()="p"]')):
        label = normalized(text(paragraph))
        links = paragraph.xpath('.//*[local-name()="a"][@href]')
        source_only = bool(links) and bool(re.fullmatch(r'(?:https?://)?(?:www\.)?(?:feb-web\.ru|lib\.ru|[a-z]+\.wikisource\.org)/?', label, re.I))
        bibliographic = bool(re.search(r'Редакторы издания:|Текст и комментарии подготовили', label))
        export_credit = bool(re.search(r'https?://|www\.', label, re.I)) and bool(re.match(
            r'^(?:Публичная Электронная Библиотека|Подготовка е-текста:|Оригинал здесь:|Библиотека Альдебаран:|Текст подготовил .*Дата последней редакции:|Исходник здесь:|Scan by |https?://\S+$|www\.\S+$)', label, re.I))
        orphan_proofreader_credit = paragraph.get('id') in {'id00000', 'id00001', 'id00002'} and bool(re.search(r'Online Distributed Proofread', label, re.I))
        # Gutenberg TXT exports put their production credit at id00000/id00001.
        # Do not match "produced by" inside the author's prose.
        production_credit = paragraph.get('id') in {'id00000', 'id00001'} and label.startswith('Produced by ')
        if production_credit:
            following = paragraph.getnext()
            while following is not None and local(following) == 'p' and (
                re.search(r'(?:Distributed Proofread|adaptations made to this work)', text(following), re.I)
            ):
                report.setdefault('_notices', []).append(text(following))
                next_el = following.getnext(); discard(following); following = next_el
        if source_only or bibliographic or production_credit or export_credit or orphan_proofreader_credit:
            report.setdefault('_notices', []).append(label)
            report['removed_blocks'] += 1
            discard(paragraph)
    # A heading owns only following siblings up to the next same/higher heading.
    # Never remove an enclosing chapter just because it contains an editorial note.
    for heading in list(body.xpath('.//*[local-name()="h1" or local-name()="h2" or local-name()="h3" or local-name()="h4" or local-name()="h5" or local-name()="h6"]')):
        label = normalized(text(heading))
        drop = bool(EDITORIAL.fullmatch(label)) or label.casefold() in {value.casefold() for value in editorial_headings}
        ids = {heading.get('id'), *heading.xpath('.//@id')}
        stop_before_text = None
        for reviewed in reviewed_sections:
            if label == reviewed['heading'] and (not reviewed.get('heading_id') or reviewed['heading_id'] in ids):
                drop = True
                stop_before_text = reviewed.get('stop_before_text')

        if not drop or heading.getparent() is None: continue
        level = int(local(heading)[1])
        unit = heading
        while unit.getparent() is not body and unit.getparent() is not None and text(unit.getparent()) == text(heading):
            unit = unit.getparent()
        following = unit.getnext()
        if stop_before_text and not any(text(el).startswith(stop_before_text) for el in unit.itersiblings()):
            raise ValueError(f'Missing reviewed boundary after {label}: {stop_before_text}')
        report['editorial_sections'].append(label)
        discard(unit)
        while following is not None:
            if stop_before_text and text(following).startswith(stop_before_text): break
            tag = local(following)
            if re.fullmatch(r'h[1-6]', tag) and int(tag[1]) <= level: break
            nested_headings = following.xpath('.//*[local-name()="h1" or local-name()="h2" or local-name()="h3" or local-name()="h4" or local-name()="h5" or local-name()="h6"]')
            if nested_headings and text(following).startswith(text(nested_headings[0])):
                first_heading = nested_headings[0]
                if int(local(first_heading)[1]) <= level or re.match(r'^(?:(?:CHAPTER|BOOK|ACT|ГЛАВА|ДЕЙСТВИЕ|ЧАСТЬ)\s+(?:[IVXLCDM0-9]+|ONE|FIRST)\b|(?:THE )?AUTHOR[\'’]S (?:PREFACE|INTRODUCTION)|ПРЕДИСЛОВИЕ АВТОРА)', text(first_heading), re.I): break
            if re.fullmatch(r'h[1-6]', tag) and re.match(r'^(?:(?:CHAPTER|BOOK|ACT|ГЛАВА|ДЕЙСТВИЕ|ЧАСТЬ)\s+(?:[IVXLCDM0-9]+|ONE|FIRST)\b|(?:THE )?AUTHOR[\'’]S (?:PREFACE|INTRODUCTION)|ПРЕДИСЛОВИЕ АВТОРА)', text(following), re.I): break
            next_el = following.getnext(); discard(following); following = next_el
    for el in doc.iter():
        if not isinstance(el.tag, str): continue
        for field in ('text', 'tail'):
            value = getattr(el, field)
            cleaned = clean_literal_markup(value)
            if cleaned and text_replacements:
                for source_text, replacement in text_replacements.items():
                    cleaned = cleaned.replace(source_text, replacement)
            if value != cleaned:
                setattr(el, field, cleaned)
                report['literal_markup_nodes_cleaned'] = report.get('literal_markup_nodes_cleaned', 0) + 1
        for key in list(el.attrib):
            name = ET.QName(key).localname
            if name.lower().startswith('on') or name.startswith('data-mw') or name in {'about', 'typeof'}:
                del el.attrib[key]
        if local(el) == 'a':
            href = el.get('href', '')
            if external(href):
                report['external_links_removed'] += 1
                # Retain the element/ID and every text node to preserve CFI positions.
                neutralize_link(el)
        if local(el) == 'meta' and el.get('http-equiv', '').lower() == 'refresh': discard(el)
    # Refresh can also be in the document head.
    for el in list(doc.xpath('//*[local-name()="meta"]')):
        if el.get('http-equiv', '').lower() == 'refresh': discard(el)
    clean_split_literal_markup(body, report)
    for el in body.iter():
        if normalize_image_floats and re.search(r'(?:^|;)\s*float\s*:\s*(?:left|right)', el.get('style', ''), re.I) and not text(el) and el.xpath('.//*[local-name()="img"]'):
            style = re.sub(r'(?:^|;)\s*float\s*:[^;]*', '', el.get('style', ''), flags=re.I)
            el.set('style', style.rstrip(';') + ';float:none;clear:both;display:block;max-width:100%;margin:1em auto;')
            report['image_floats_normalized'] = report.get('image_floats_normalized', 0) + 1

def remove_navigation_node(node, child_xpath):
    parent = node.getparent()
    if parent is None: return
    index = parent.index(node)
    for child in list(node.xpath(child_xpath)):
        parent.insert(index, child)
        index += 1
    discard(node)

def is_service_document(name, doc):
    titles = doc.xpath('//*[local-name()="title"]') + doc.xpath('//*[local-name()="body"]//*[local-name()="h1"]')[:1]
    labels = [normalized(text(el)).lower() for el in titles]
    return (posixpath.basename(name).lower() in {'about.xhtml', 'pg-header.xhtml', 'pg-footer.xhtml'}
            or any('wsexport_about' in label or label == 'об этом электронном издании'
                   or label in {'the full project gutenberg license', 'the project gutenberg license'} for label in labels))

def clean_epub(source, destination, title=None, author=None, editorial_headings=(), reviewed_sections=(), text_replacements=None, normalize_image_floats=False, navigation_repair=None):
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve(): raise ValueError('Output must differ from input')
    original = source.read_bytes()
    report = {'source_sha256': hashlib.sha256(original).hexdigest(), 'external_links_removed': 0,
              'removed_blocks': 0, 'editorial_sections': [], 'nonreading_documents': [], 'warnings': [], 'text_changes': []}
    with zipfile.ZipFile(source) as archive:
        if sum(i.file_size for i in archive.infolist()) > 256 * 1024 * 1024: raise ValueError('Expanded EPUB exceeds 256 MiB')
        names = [i.filename for i in archive.infolist()]
        if len(names) != len(set(names)): raise ValueError('Duplicate archive entries')
        if any(name.startswith('/') or '..' in name.split('/') or '\\' in name for name in names):
            raise ValueError('Unsafe archive entry path')
        files = {i.filename: archive.read(i) for i in archive.infolist() if not i.is_dir()}
    original_files = dict(files)
    container = parse(files['META-INF/container.xml'])
    opf_name = container.xpath('//*[local-name()="rootfile"]')[0].get('full-path')
    opf = parse(files[opf_name]); manifest = {}
    for item in opf.xpath('//*[local-name()="manifest"]/*'):
        manifest[item.get('id')] = (member_path(opf_name, item.get('href', '')), item)
    metadata = opf.xpath('//*[local-name()="metadata"]')[0]
    for name, value in [('title', title), ('creator', author)]:
        nodes = metadata.findall(f'{{{DC}}}{name}')
        if value:
            if not nodes: nodes = [ET.SubElement(metadata, f'{{{DC}}}{name}')]
            nodes[0].text = normalized(value)
            # Preserve additional creators, role attribution and translators.
        else:
            for node in nodes:
                if node.text: node.text = normalized(node.text)
    excluded = set(); docs = {}
    for name, item in manifest.values():
        if item.get('media-type') not in {'application/xhtml+xml', 'text/html'}: continue
        doc = read_document(files[name], report, name); docs[name] = doc
        if is_service_document(name, doc): excluded.add(name)
        before_body = next(iter(doc.xpath('//*[local-name()="body"]')), None)
        before_chars = len(text(before_body)) if before_body is not None else 0
        if not (name == 'Narra/source-notices.xhtml' and item.get('id') == 'narra-source-notices'):
            clean_document(doc, report, editorial_headings, [row for row in reviewed_sections if row['document'] == name], text_replacements, normalize_image_floats)
        after_chars = len(text(before_body)) if before_body is not None else 0
        if before_chars != after_chars:
            report['text_changes'].append({'document': name, 'before': before_chars, 'after': after_chars})
        for label in doc.xpath('//*[local-name()="title"]'):
            if label.text: label.text = normalized(label.text)
        if item.get('id') == 'title' or posixpath.basename(name).lower() in {'title.xhtml', 'titlepage.xhtml'}:
            if title:
                headings = doc.xpath('//*[local-name()="h1"]')
                if len(headings) == 1:
                    heading = headings[0]
                    for child in list(heading): heading.remove(child)
                    heading.text = normalized(title)

        if name not in excluded:
            body = next(iter(doc.xpath('//*[local-name()="body"]')), None)
            if body is not None and not text(body) and not body.xpath('.//*[local-name()="img" or local-name()="svg"]'):
                excluded.add(name)
    for ref in opf.xpath('//*[local-name()="spine"]/*'):
        name, _ = manifest[ref.get('idref')]
        if name in excluded: ref.set('linear', 'no')
    report['nonreading_documents'] = sorted(excluded)
    ids_by_document = {name: set(doc.xpath('//@id')) for name, doc in docs.items()}
    def readable_link(document, href):
        if not href or external(href): return False
        target = member_path(document, href)
        if target in excluded or target not in docs: return False
        fragment = unquote(href.partition('#')[2])
        return not fragment or fragment.startswith('epubcfi(') or fragment in ids_by_document[target]

    # Prune invalid/removed destinations without dropping their valid child chapters.

    ncxs = {}
    for name, item in manifest.values():
        if item.get('media-type') == 'application/x-dtbncx+xml':
            ncx = read_document(files[name], report, name)
            ncxs[name] = ncx
            for point in list(ncx.xpath('//*[local-name()="navPoint" or local-name()="pageTarget" or local-name()="navTarget"]')):
                content = next(iter(point.xpath('./*[local-name()="content"]')), None)
                if content is not None and not readable_link(name, content.get('src', '')):
                    report['navigation_links_removed'] = report.get('navigation_links_removed', 0) + 1
                    remove_navigation_node(point, './*[local-name()="navPoint"]')
            for label in ncx.xpath('//*[local-name()="navLabel"]/*[local-name()="text"]'):
                if label.text: label.text = normalized(label.text)
            files[name] = serialize(ncx)
        elif 'nav' in item.get('properties', '').split():
            doc = docs[name]
            for anchor in list(doc.xpath('//*[local-name()="a"][@href]')):
                if not readable_link(name, anchor.get('href')):
                    report['navigation_links_removed'] = report.get('navigation_links_removed', 0) + 1
                    parent = anchor.getparent()
                    if local(parent) == 'li':
                        remove_navigation_node(parent, './*[local-name()="ol" or local-name()="ul"]/*[local-name()="li"]')
                    else: discard(anchor)
    for name, doc in docs.items():
        for anchor in list(doc.xpath('//*[local-name()="a"][@href]')):
            if not readable_link(name, anchor.get('href')):
                neutralize_link(anchor)
                report['dangling_links_removed'] = report.get('dangling_links_removed', 0) + 1
                parent = anchor.getparent()
                if local(parent) == 'sup' and re.fullmatch(r'[\[\]\d\s↑*]+', text(parent)):
                    discard(parent)

    languages = metadata.findall(f'{{{DC}}}language')
    recover_navigation(docs, ncxs, manifest, opf, navigation_repair, report)
    remove_contents_column_labels(docs, ncxs, report)
    # Volume-sized documents become chapter-sized parts (see split_documents.py)
    # before heading normalization, so the new chapter entries and their headings
    # get the same treatment as every other navigation label.
    split_large_documents(docs, ncxs, manifest, opf, opf_name, excluded, report, member_path)
    normalize_chapters(docs, ncxs, manifest, excluded, report, member_path, text,
                       languages[0].text if languages and languages[0].text else 'ru')
    for name, ncx in ncxs.items(): files[name] = serialize(ncx)
    notices = report.pop('_notices', [])
    if notices:
        notice_name = 'Narra/source-notices.xhtml'
        if notice_name in files: raise ValueError('Source notices path already exists')
        notice_doc = ET.Element(f'{{{XHTML}}}html', nsmap={None: XHTML})
        head = ET.SubElement(notice_doc, f'{{{XHTML}}}head')
        ET.SubElement(head, f'{{{XHTML}}}title').text = 'Source notices'
        body = ET.SubElement(notice_doc, f'{{{XHTML}}}body')
        for notice in notices: ET.SubElement(body, f'{{{XHTML}}}p').text = notice
        files[notice_name] = serialize(notice_doc)
        manifest_el = opf.xpath('//*[local-name()="manifest"]')[0]
        ET.SubElement(manifest_el, f'{{{OPF}}}item', id='narra-source-notices', href=posixpath.relpath(notice_name, posixpath.dirname(opf_name)), attrib={'media-type': 'application/xhtml+xml'})
        report['preserved_notices'] = len(notices)
    for name, doc in docs.items(): files[name] = serialize(doc)
    files[opf_name] = serialize(opf)
    # Verify every packaged XML document and every linear spine target before writing.
    for name, data in files.items():
        if name.lower().endswith(('.xhtml', '.opf', '.ncx', '.xml')): parse(data)
    linear = [r for r in opf.xpath('//*[local-name()="spine"]/*') if r.get('linear') != 'no']
    if not linear: raise ValueError('Cleanup removed every reading section')
    changed = set(files) != set(original_files)
    for name, data in files.items():
        if name not in original_files or data == original_files[name]: continue
        try:
            if ET.tostring(parse(data), method='c14n') != ET.tostring(parse(original_files[name]), method='c14n'): changed = True
        except ET.XMLSyntaxError:
            changed = True
    report['changed'] = changed
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not changed:
        destination.write_bytes(original)
        report['output_sha256'] = report['source_sha256']
        return report
    with zipfile.ZipFile(destination, 'w') as archive:
        for name in ['mimetype'] + sorted(set(files) - {'mimetype'}):
            info = zipfile.ZipInfo(name, date_time=(2000, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED if name == 'mimetype' else zipfile.ZIP_DEFLATED
            archive.writestr(info, files[name])
    report['output_sha256'] = hashlib.sha256(destination.read_bytes()).hexdigest()
    return report

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path); parser.add_argument('destination', type=Path)
    parser.add_argument('--title'); parser.add_argument('--author')
    args = parser.parse_args()
    print(json.dumps(clean_epub(**vars(args)), ensure_ascii=False, indent=2))
