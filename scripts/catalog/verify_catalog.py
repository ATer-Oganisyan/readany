#!/usr/bin/env python3
"""Verify all catalog EPUBs and prove a second cleanup makes no byte changes."""
import argparse
import hashlib
import json
import re
import tempfile
import zipfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from urllib.parse import unquote
from clean_epub import clean_epub, parse, text, external, member_path, REMOVE_TAGS


def verify_one(task):
    book, directory, review = task
    ident = book['book_edition_id']
    source = Path(directory)/f'{ident}.epub'
    result = {'id': ident, 'title': book['title'], 'linear_sections': 0, 'navigation_entries': 0}
    try:
        with zipfile.ZipFile(source) as archive:
            docs = {}
            for name in archive.namelist():
                if name.lower().endswith(('.xml', '.opf', '.ncx', '.xhtml', '.html', '.htm')):
                    docs[name] = parse(archive.read(name))
            opfname = docs['META-INF/container.xml'].xpath('//*[local-name()="rootfile"]/@full-path')[0]
            opf = docs[opfname]
            manifest = {el.get('id'): (member_path(opfname, el.get('href')), el)
                        for el in opf.xpath('//*[local-name()="manifest"]/*')}
            linear = []
            for ref in opf.xpath('//*[local-name()="spine"]/*'):
                name, _ = manifest[ref.get('idref')]
                if name not in docs: raise ValueError(f'Missing spine document: {name}')
                if ref.get('linear') != 'no': linear.append(name)
            if not linear: raise ValueError('No reading sections')
            result['linear_sections'] = len(linear)
            for name in linear:
                doc = docs[name]
                for anchor in doc.xpath('//*[local-name()="a"][@href]'):
                    href = anchor.get('href')
                    if external(href): raise ValueError(f'External reading link: {name}')
                    target = member_path(name, href)
                    if target not in docs: raise ValueError(f'Dangling link: {name} -> {target}')
                    fragment = unquote(href.partition('#')[2])
                    if fragment and not fragment.startswith('epubcfi(') and fragment not in set(docs[target].xpath('//@id')):
                        raise ValueError(f'Dangling fragment: {name} -> {href}')
                if any(doc.xpath(f'//*[local-name()="{tag}"]') for tag in REMOVE_TAGS):
                    raise ValueError(f'Executable or embedded page content: {name}')
                body = doc.xpath('//*[local-name()="body"]')
                if body and re.search(r'<{1,2}/?(?:span|div|br|a|p)\b[^>]*>', text(body[0]), re.I):
                    raise ValueError(f'Visible export markup: {name}')
            for name, item in manifest.values():
                if item.get('media-type') == 'application/x-dtbncx+xml':
                    links = docs[name].xpath('//*[local-name()="content"]/@src')
                elif 'nav' in item.get('properties', '').split():
                    links = docs[name].xpath('//*[local-name()="a"]/@href')
                else: continue
                result['navigation_entries'] += len(links)
                for href in links:
                    target = member_path(name, href)
                    if external(href) or target not in docs: raise ValueError(f'Invalid TOC destination: {href}')
                    fragment = unquote(href.partition('#')[2])
                    if fragment and not fragment.startswith('epubcfi(') and fragment not in set(docs[target].xpath('//@id')):
                        raise ValueError(f'Invalid TOC fragment: {href}')
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)/'repeat.epub'
            clean_epub(source, target, title=book['title'], author=book['author'],
                       editorial_headings=review.get('editorial_headings', []),
                       reviewed_sections=review.get('sections', []),
                       text_replacements=review.get('text_replacements'),
                       navigation_repair=review.get('navigation_repair'),
                      normalize_image_floats=review.get('normalize_image_floats', False))
            if source.read_bytes() != target.read_bytes(): raise ValueError('Cleanup is not idempotent')
        result['sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
    except Exception as error:
        result['error'] = f'{type(error).__name__}: {error}'
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('books', type=Path)
    parser.add_argument('report', type=Path)
    parser.add_argument('--workers', type=int, default=2)
    args = parser.parse_args()
    books = json.loads(args.snapshot.read_text())
    reviews = json.loads(Path(__file__).with_name('reviewed-sections.json').read_text())
    tasks = [(book, str(args.books), reviews.get(book['book_edition_id'], {})) for book in books]
    results = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for result in pool.map(verify_one, tasks):
            results.append(result)
            if len(results) % 100 == 0: print(f'Verified {len(results)}/{len(books)}', flush=True)
    failures = [r for r in results if 'error' in r]
    args.report.write_text(json.dumps({'checked': len(results), 'failures': failures, 'results': results}, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'checked': len(results), 'failures': failures}, ensure_ascii=False, indent=2))
    raise SystemExit(bool(failures))
