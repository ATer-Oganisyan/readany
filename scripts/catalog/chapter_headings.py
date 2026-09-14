"""Sentence-case chapter labels without changing destinations or flattening markup."""
import difflib
import re
from urllib.parse import unquote

STARS = re.compile(r'\[\s*[*✱✳✻⁎∗]+\s*\]|[*✱✳✻⁎∗]+')
ROMAN = re.compile(r'M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$', re.I)
NUMBER_PREFIX = re.compile(r'(?i)(?:chapter|book|part|act|scene|volume|глава|часть|том|книга|действие|явление|сцена)\s*$')


def sentence_case(value, fallback=''):
    value = ' '.join(STARS.sub('', value).replace('\u200b', '').split()).strip()
    if not value: return fallback
    protected = []
    for match in re.finditer(r'\b[IVXLCDM]+\b', value, re.I):
        token = match.group()
        if ROMAN.fullmatch(token) and (not value[:match.start()].strip(' .(—–-') or
                NUMBER_PREFIX.search(value[:match.start()]) or token == 'I'):
            protected.append((match.start(), match.end()))
    letters = [i for i, ch in enumerate(value) if ch.isalpha() and not any(a <= i < b for a, b in protected)]
    first = letters[0] if letters else -1
    return ''.join(ch.upper() if i == first or any(a <= i < b for a, b in protected) else ch.lower()
                   for i, ch in enumerate(value))


def text_slots(element):
    if element.text: yield element, 'text', element.text
    for child in element:
        if isinstance(child.tag, str): yield from text_slots(child)
        if child.tail: yield child, 'tail', child.tail


def replace_text(element, value):
    """Redistribute edits across original text nodes, retaining IDs and footnote anchors."""
    slots = list(text_slots(element))
    old = ''.join(s[2] for s in slots)
    if old == value: return
    if not slots:
        element.text = value
        return
    owners = [i for i, slot in enumerate(slots) for _ in slot[2]]
    result = ['' for _ in slots]
    for tag, a, b, c, d in difflib.SequenceMatcher(None, old, value, autojunk=False).get_opcodes():
        if tag == 'equal':
            for j in range(a, b): result[owners[j]] += old[j]
        elif tag in ('insert', 'replace'):
            for j, ch in enumerate(value[c:d]):
                owner = owners[min(a + j, b - 1)] if b > a else owners[min(a, len(owners)-1)]
                result[owner] += ch
    for (node, field, _), content in zip(slots, result): setattr(node, field, content)


def normalize_chapters(docs, ncxs, manifest, excluded, report, member_path, text, language='ru'):
    changes = report.setdefault('chapter_heading_changes', [])
    seen = set()
    targets = {}
    def change(name, element, fallback='', visual=True):
        if element in seen: return
        seen.add(element)
        before = text(element)
        after = sentence_case(before, fallback)
        # Standalone scene ornaments outside the TOC are part of the author's layout.
        if not after: return
        replace_text(element, after)
        if visual:
            for node in element.iter():
                if not isinstance(node.tag, str): continue
                style = re.sub(r'(?:^|;)\s*(?:text-transform|font-variant)\s*:[^;]*', '', node.get('style', ''), flags=re.I).strip('; ')
                node.set('style', (style+';' if style else '')+'text-transform:none!important;font-variant:normal!important')
        if before != after: changes.append({'document': name, 'before': before, 'after': after})

    entries = []
    for name, ncx in ncxs.items():
        for point in ncx.xpath('//*[local-name()="navPoint"]'):
            labels = point.xpath('./*[local-name()="navLabel"]/*[local-name()="text"]')
            hrefs = point.xpath('./*[local-name()="content"]/@src')
            if labels and hrefs: entries.append((name, labels[0], hrefs[0], False))
    for name, item in manifest.values():
        if name not in docs or name in excluded: continue
        if 'nav' in item.get('properties', '').split():
            for a in docs[name].xpath('//*[local-name()="nav"]//*[local-name()="a"][@href]'):
                entries.append((name, a, a.get('href'), True))
    for name, label, href, visual in entries:
        target = (member_path(name, href), unquote(href.partition('#')[2]))
        if target not in targets: targets[target] = len(targets)+1
        fallback = ('Section ' if language.startswith('en') else 'Раздел ') + str(targets[target])
        original = text(label)
        change(name, label, fallback, visual)
        target_name, fragment = target
        if target_name not in docs or target_name in excluded: continue
        doc = docs[target_name]
        candidates = doc.xpath('//*[@id=$id]', id=fragment) if fragment else doc.xpath('//*[local-name()="body"]/*')[:1]
        if not candidates: continue
        candidate = candidates[0]
        # An empty anchor may precede its heading; never rewrite an entire chapter container.
        if not text(candidate) and candidate.getnext() is not None: candidate = candidate.getnext()
        if text(candidate).casefold() == original.casefold(): change(target_name, candidate, fallback)
    for name, doc in docs.items():
        if name in excluded or name == 'Narra/source-notices.xhtml': continue
        # Some valid XML exports omit <body>; browsers still render their headings.
        for heading in doc.xpath('//*[local-name()="h1" or local-name()="h2" or local-name()="h3" or local-name()="h4" or local-name()="h5" or local-name()="h6" or @data-narra-heading="true"]'):
            change(name, heading)
