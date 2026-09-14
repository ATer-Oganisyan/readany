#!/usr/bin/env python3
"""Use the same cleanup rules for the EPUBs shipped inside the mobile app."""
import json
import re
import tempfile
from pathlib import Path
from clean_epub import clean_epub, normalized

ROOT = Path(__file__).resolve().parents[2]


def clean_bundled():
    definitions = (ROOT/'packages/app-expo/src/lib/catalog/bundled-book-definitions.ts').read_text()
    books = [dict(re.findall(r'(id|title|author|fileName): "([^"]+)"', block))
             for block in re.findall(r'\{\s*id:.*?\}', definitions, re.S)]
    books = [book for book in books if 'fileName' in book]
    if not books: raise ValueError('No bundled catalog definitions found')
    reviews = json.loads(Path(__file__).with_name('reviewed-sections.json').read_text())
    directory = ROOT/'packages/app-expo/assets/catalog'
    reports = []
    with tempfile.TemporaryDirectory() as temporary:
        for book in books:
            headings = set()
            for review in reviews.values():
                if normalized(review['title']).casefold().replace('ё', 'е') == normalized(book['title']).casefold().replace('ё', 'е'):
                    headings.update(review.get('editorial_headings', []))
            report = clean_epub(directory/book['fileName'], Path(temporary)/book['fileName'],
                                title=book['title'], author=book['author'], editorial_headings=headings)
            reports.append({'file': book['fileName'], **report})
        # Write only after every book has passed cleanup validation.
        for book in books:
            (directory/book['fileName']).write_bytes((Path(temporary)/book['fileName']).read_bytes())
    return reports


if __name__ == '__main__':
    print(json.dumps(clean_bundled(), ensure_ascii=False, indent=2))
