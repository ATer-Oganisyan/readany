#!/usr/bin/env python3
"""Build an offline, hash-verified catalog replacement bundle. Never writes to a server."""
import argparse
import hashlib
import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from clean_epub import clean_epub


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean_one(task):
    book, sources, output, review = task
    ident = book['book_edition_id']
    return clean_epub(Path(sources) / f'{ident}.epub', Path(output) / 'books' / f'{ident}.epub',
                      title=book['title'], author=book['author'],
                      editorial_headings=review.get('editorial_headings', []),
                      reviewed_sections=review.get('sections', []),
                      text_replacements=review.get('text_replacements'),
                      normalize_image_floats=review.get('normalize_image_floats', False))


def clean_catalog(snapshot, sources, output, reviews, workers=2):
    snapshot, sources, output = Path(snapshot), Path(sources), Path(output)
    books = json.loads(snapshot.read_text())
    selections = json.loads(Path(reviews).read_text())
    if not isinstance(books, list) or not books:
        raise ValueError('Snapshot must contain books')
    if output.resolve() == sources.resolve() or sources.resolve() in output.resolve().parents:
        raise ValueError('Output must be separate from source directory')
    ids = [book['book_edition_id'] for book in books]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate edition IDs')
    # Verify the entire input before producing any replacement manifest.
    for book in books:
        ident = book['book_edition_id']
        if not re.fullmatch(r'[A-Za-z0-9_-]+', ident):
            raise ValueError('Invalid edition ID')
        source = sources / f'{ident}.epub'
        if not source.is_file() or sha256(source) != book['content_sha256']:
            raise ValueError(f'Missing or changed source: {ident}')
        review = selections.get(ident)
        if review and review['source_sha256'] != book['content_sha256']:
            raise ValueError(f'Review is for a different source: {ident}')
    output.mkdir(parents=True, exist_ok=True)
    # A failed rerun must not leave a previous manifest looking publishable.
    manifest_path = output / 'manifest.json'
    manifest_path.unlink(missing_ok=True)
    reports, replacements = [], []
    tasks = [(book, str(sources), str(output), selections.get(book['book_edition_id'], {})) for book in books]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        reports_iterator = pool.map(clean_one, tasks)
        for index, (book, report) in enumerate(zip(books, reports_iterator), 1):
            ident = book['book_edition_id']
            report.update({'id': ident, 'title': book['title'], 'catalog_key': book['catalog_key'], 'language': book['language']})
            reports.append(report)
            if report['changed']:
                replacements.append({
                    'catalog_key': f"catalog-clean-{ident}-{report['output_sha256'][:12]}",
                    'file': f'books/{ident}.epub', 'format': 'epub', 'mime_type': 'application/epub+zip',
                    'title': book['title'], 'author': book['author'], 'language': book['language'],
                    'content_sha256': report['output_sha256'], 'genres': book.get('genres', []),
                    'replaces': {'book_edition_id': ident, 'catalog_key': book['catalog_key'],
                                 'content_sha256': book['content_sha256'], 'cover': book.get('cover')},
                })
            if index % 100 == 0: print(f'Cleaned {index}/{len(books)}', flush=True)
    summary = {
        'books': len(books), 'changed': len(replacements), 'unchanged': len(books)-len(replacements),
        'external_links_removed': sum(r['external_links_removed'] for r in reports),
        'editorial_sections_removed': sum(len(r['editorial_sections']) for r in reports),
        'service_documents_excluded': sum(len(r['nonreading_documents']) for r in reports),
        'xml_documents_repaired': sum(len(r.get('repaired_xml', [])) for r in reports),
        'image_floats_normalized': sum(r.get('image_floats_normalized', 0) for r in reports),
        'chapter_headings_normalized': sum(len(r.get('chapter_heading_changes', [])) for r in reports),
        'snapshot_sha256': sha256(snapshot), 'review_sha256': sha256(Path(reviews)),
    }
    (output / 'report.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2)+'\n')
    (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
    manifest_path.write_text(json.dumps({'schema_version': 1, 'books': replacements}, ensure_ascii=False, indent=2)+'\n')
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('sources', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--reviews', type=Path, default=Path(__file__).with_name('reviewed-sections.json'))
    try: print(json.dumps(clean_catalog(**vars(parser.parse_args())), ensure_ascii=False, indent=2))
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
