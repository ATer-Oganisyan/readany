#!/usr/bin/env python3
"""Independent read-only audit of visible catalog content (stdlib XML, no cleaner import)."""
import argparse
import json
import posixpath
import re
import zipfile
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET


def tag(el): return el.tag.rsplit('}', 1)[-1].lower()
def text(el): return ' '.join(''.join(el.itertext()).split())


def audit(snapshot, directory):
    findings = []
    counts = {'books': 0, 'reading_documents': 0, 'reading_characters': 0,
              'external_navigation': 0, 'visible_markup': 0, 'site_credits': 0,
              'suspicious_encoding': 0, 'invalid_xml': 0}
    for book in json.loads(Path(snapshot).read_text()):
        ident = book['book_edition_id']
        with zipfile.ZipFile(Path(directory)/f'{ident}.epub') as archive:
            root = ET.fromstring(archive.read('META-INF/container.xml'))
            opfname = next(el.get('full-path') for el in root.iter() if tag(el) == 'rootfile')
            opf = ET.fromstring(archive.read(opfname))
            manifest = {el.get('id'): posixpath.normpath(posixpath.join(posixpath.dirname(opfname), unquote(el.get('href'))))
                        for el in opf.iter() if tag(el) == 'item'}
            linear = [manifest[el.get('idref')] for el in opf.iter() if tag(el) == 'itemref' and el.get('linear') != 'no']
            counts['books'] += 1
            for name in linear:
                try: doc = ET.fromstring(archive.read(name))
                except ET.ParseError as error:
                    counts['invalid_xml'] += 1
                    findings.append({'id': ident, 'title': book['title'], 'document': name, 'kind': 'invalid_xml', 'text': str(error)})
                    continue
                body = next((el for el in doc.iter() if tag(el) == 'body'), doc)
                value = text(body)
                counts['reading_documents'] += 1
                counts['reading_characters'] += len(value)
                checks = []
                for el in doc.iter():
                    if tag(el) not in {'a', 'area'}: continue
                    for attr, href in el.attrib.items():
                        if attr.rsplit('}', 1)[-1].lower() == 'href' and re.match(r'\s*(?:[a-z][a-z0-9+.-]*:|//)', href, re.I):
                            checks.append(('external_navigation', href))
                for match in re.finditer(r'<{1,2}/?(?:html|span|div|br|a|p|h[1-6])\b[^>]*>', value, re.I):
                    checks.append(('visible_markup', value[max(0, match.start()-60):match.end()+60]))
                for match in re.finditer(r'\ufffd|(?:[РС][\u0400-\u04ff]){4,}|(?:[ÐÑ][\x80-\xbf]){4,}', value):
                    checks.append(('suspicious_encoding', value[max(0, match.start()-60):match.end()+60]))
                for el in body.iter():
                    if tag(el) not in {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}: continue
                    paragraph = text(el)
                    if re.search(r'https?://|www\.|wikisource\.org|wiktionary\.org|\[править\]|This eBook is for|\*\*\*.*(?:START|END).*EBOOK|Wsexport|Редакторы издания|Online Distributed Proofread|Transcriber.s Note|^Produced by (?!will\b)', paragraph, re.I):
                        checks.append(('site_credits', paragraph[:500]))
                for kind, detail in checks:
                    counts[kind] += 1
                    findings.append({'id': ident, 'title': book['title'], 'document': name, 'kind': kind, 'text': detail})
    return {'counts': counts, 'findings': findings}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path); parser.add_argument('books', type=Path); parser.add_argument('report', type=Path)
    args = parser.parse_args()
    result = audit(args.snapshot, args.books)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(result['counts'], ensure_ascii=False, indent=2))
    # Credits need editorial review; actionable links/markup/XML failures are hard failures.
    raise SystemExit(bool(sum(result['counts'][key] for key in ['external_navigation', 'visible_markup', 'invalid_xml'])))
