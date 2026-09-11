#!/usr/bin/env python3
"""Download the checked-in catalog snapshot using an ordinary reader token; no admin API."""
import argparse
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path


def fetch_snapshot(snapshot, destination, base_url, token):
    books = json.loads(Path(snapshot).read_text())
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    for index, book in enumerate(books, 1):
        if not re.fullmatch(r'[A-Za-z0-9_-]+', book['book_edition_id']):
            raise ValueError('Invalid edition ID')
        target = destination / f"{book['book_edition_id']}.epub"
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == book['content_sha256']:
            continue
        endpoint = f"/v2/books/{book['book_edition_id']}/source/download"
        for attempt in range(5):
            try:
                request = urllib.request.Request(base_url.rstrip('/')+endpoint, headers={'Authorization': 'Bearer '+token})
                with urllib.request.urlopen(request, timeout=60) as response:
                    signed_url = json.load(response)['download_url']
                # The reader credential is never sent to object storage.
                with urllib.request.urlopen(signed_url, timeout=120) as response:
                    content = response.read()
                if hashlib.sha256(content).hexdigest() != book['content_sha256']:
                    raise ValueError(f'Source changed: {book["book_edition_id"]}')
                target.write_bytes(content)
                break
            except urllib.error.HTTPError as error:
                if error.code != 429 or attempt == 4: raise
                time.sleep(min(60, max(1, int(error.headers.get('Retry-After', '30')))))
        print(f'{index}/{len(books)} {book["title"]}', flush=True)
        time.sleep(0.8)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--base-url', required=True)
    args = parser.parse_args()
    token = os.environ.get('NARRA_READER_TOKEN', '')
    if not token: parser.error('Set NARRA_READER_TOKEN to an ordinary reader token; reruns resume verified files')
    fetch_snapshot(args.snapshot, args.destination, args.base_url, token)
