#!/usr/bin/env python3
"""Independent heading audit: stdlib XML only, no imports from the cleaner."""
import argparse
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


def tag(el): return el.tag.rsplit('}', 1)[-1]
def text(el): return ' '.join(''.join(el.itertext()).split())


def issue(value, ornament_allowed=False):
    if not value: return None
    if re.search(r'[*✱✳✻⁎∗]', value):
        if ornament_allowed and not re.search(r'[^*✱✳✻⁎∗\s]', value): return None
        return 'ornament'
    remaining = list(value)
    for m in re.finditer(r'\b[IVXLCDM]+\b', value):
        prefix = value[:m.start()]
        if (not prefix.strip(' .(—–-') or re.search(r'(?:chapter|book|part|act|scene|volume|глава|часть|том|книга|действие|явление|сцена)\s*$', prefix, re.I) or m.group() == 'I'):
            remaining[m.start():m.end()] = ' ' * len(m.group())
    letters = [ch for ch in remaining if ch.isalpha()]
    if letters and (not letters[0].isupper() or any(ch.isupper() for ch in letters[1:])): return 'case'
    return None


def audit(directory, baseline=None):
    findings = []; counts = {'books':0, 'headings':0, 'toc_labels':0, 'topology_checks':0}
    for path in sorted(Path(directory).glob('*.epub')):
        counts['books'] += 1
        with zipfile.ZipFile(path) as z:
            previous = zipfile.ZipFile(Path(baseline)/path.name) if baseline else None
            try:
                for name in z.namelist():
                    if not name.endswith(('.xhtml','.html','.ncx')) or name in {'Narra/source-notices.xhtml'}: continue
                    doc = ET.fromstring(z.read(name))
                    labels = []
                    for el in doc.iter():
                        if tag(el) in {'h1','h2','h3','h4','h5','h6'}:
                            labels.append((el,'headings'))
                        if tag(el) == 'navPoint':
                            labels.extend((child,'toc_labels') for label in el if tag(label)=='navLabel' for child in label if tag(child)=='text')
                        if tag(el) == 'nav':
                            labels.extend((child,'toc_labels') for child in el.iter() if tag(child)=='a')
                    # Source notices and non-reading publication service documents are not chapters.
                    if Path(name).name in {'about.xhtml','pg-header.xhtml','pg-footer.xhtml'}: labels=[]
                    for el, kind in labels:
                        counts[kind] += 1
                        problem = issue(text(el), kind=='headings')
                        if problem: findings.append({'book':path.stem,'document':name,'kind':problem,'label':text(el)})
                    if previous and name in previous.namelist():
                        old = ET.fromstring(previous.read(name))
                        for key in ['id','href','src']:
                            before = [el.get(key) for el in old.iter() if el.get(key) is not None]
                            after = [el.get(key) for el in doc.iter() if el.get(key) is not None]
                            counts['topology_checks'] += 1
                            if before != after: findings.append({'book':path.stem,'document':name,'kind':'changed '+key})
            finally:
                if previous: previous.close()
    return {'counts':counts,'findings':findings}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('books',type=Path);parser.add_argument('report',type=Path)
    parser.add_argument('--baseline',type=Path)
    args=parser.parse_args();result=audit(args.books,args.baseline)
    args.report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'counts':result['counts'],'findings':len(result['findings'])}))
    raise SystemExit(bool(result['findings']))
