#!/usr/bin/env python3
"""Upload one catalog book to Narra Gateway and enqueue its processing job."""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = "https://api-test.narra.disrupt.builders"
MAX_BOOK_BYTES = 50 * 1024 * 1024
MAX_COVER_BYTES = 10 * 1024 * 1024
CATALOG_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
FORMATS = {
    "epub": "application/epub+zip",
    "fb2": "application/x-fictionbook+xml",
    "txt": "text/plain",
    "pdf": "application/pdf",
}
COVER_FORMATS = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Загрузить каталожную книгу в Narra staging и поставить её в очередь worker.",
    )
    parser.add_argument("book", type=Path, help="Путь к EPUB, FB2, TXT или PDF")
    parser.add_argument("--catalog-key", required=True, help="Стабильный ключ: например, seagull")
    parser.add_argument("--title", help="Название; по умолчанию используется имя файла")
    parser.add_argument("--author", default="", help="Автор книги")
    parser.add_argument(
        "--language",
        choices=("ru", "en"),
        help="Язык книги; для ключей narra-ru-/narra-en- определяется автоматически",
    )
    parser.add_argument("--cover", type=Path, help="Необязательная обложка JPEG, PNG или WebP")
    parser.add_argument("--format", choices=sorted(FORMATS), help="Формат, если его нельзя взять из расширения")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("CATALOG_BASE_URL", DEFAULT_BASE_URL),
        help=f"Gateway URL (по умолчанию: {DEFAULT_BASE_URL})",
    )
    parser.add_argument("--timeout", type=float, default=120.0, help="Таймаут одного запроса в секундах")
    return parser.parse_args()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def request_json(
    url: str,
    *,
    token: str,
    method: str = "POST",
    content_type: str = "application/json",
    body: bytes = b"",
    timeout: float = 120.0,
) -> dict:
    request = Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": content_type,
            "User-Agent": "narra-catalog-uploader/1",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            raw_body = response.read()
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1000]
        raise RuntimeError(f"HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Не удалось подключиться к Gateway: {error.reason}") from error

    if not raw_body:
        return {}
    try:
        value = json.loads(raw_body)
    except json.JSONDecodeError as error:
        preview = raw_body.decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Gateway вернул не JSON: {preview}") from error
    if not isinstance(value, dict):
        raise RuntimeError("Gateway вернул JSON неожиданного формата")
    return value


def admin_url(base_url: str, path: object) -> str:
    if not isinstance(path, str) or not path.startswith("/v2/admin/catalog/books/"):
        raise RuntimeError(f"Gateway вернул небезопасный служебный путь: {path!r}")
    return f"{base_url}{path}"


def print_response(label: str, value: dict) -> None:
    print(f"\n{label}")
    print(json.dumps(value, ensure_ascii=False, indent=2))


def upload() -> None:
    args = parse_args()
    book = args.book.expanduser().resolve()
    if not book.is_file():
        raise ValueError(f"Файл не найден: {book}")

    byte_size = book.stat().st_size
    if byte_size < 1 or byte_size > MAX_BOOK_BYTES:
        raise ValueError(f"Размер книги должен быть от 1 байта до {MAX_BOOK_BYTES // 1024 // 1024} MiB")

    book_format = args.format or book.suffix.lower().lstrip(".")
    if book_format not in FORMATS:
        raise ValueError("Не удалось определить формат. Укажите --format: epub, fb2, txt или pdf")
    if not CATALOG_KEY_RE.fullmatch(args.catalog_key):
        raise ValueError("--catalog-key должен содержать только a-z, 0-9, точку, дефис или подчёркивание")

    base_url = args.base_url.strip().rstrip("/")
    if not base_url.startswith(("https://", "http://127.0.0.1:", "http://localhost:")):
        raise ValueError("--base-url должен использовать HTTPS или локальный localhost")
    if args.timeout <= 0:
        raise ValueError("--timeout должен быть больше нуля")

    cover = args.cover.expanduser().resolve() if args.cover else None
    cover_mime_type = None
    if cover:
        if not cover.is_file():
            raise ValueError(f"Файл обложки не найден: {cover}")
        cover_mime_type = COVER_FORMATS.get(cover.suffix.lower())
        if not cover_mime_type:
            raise ValueError("Обложка должна иметь формат JPEG, PNG или WebP")
        if cover.stat().st_size < 1 or cover.stat().st_size > MAX_COVER_BYTES:
            raise ValueError("Размер обложки должен быть от 1 байта до 10 MiB")

    token = os.environ.get("CATALOG_INGEST_TOKEN", "").strip()
    if not token:
        token = getpass.getpass("CATALOG_INGEST_TOKEN: ").strip()
    if len(token) < 32:
        raise ValueError("CATALOG_INGEST_TOKEN должен содержать не менее 32 символов")

    print(f"Считаю SHA-256: {book}")
    content_sha256 = file_sha256(book)
    language = args.language
    if not language and args.catalog_key.startswith("narra-ru-"):
        language = "ru"
    if not language and args.catalog_key.startswith("narra-en-"):
        language = "en"
    metadata = {
        "catalog_key": args.catalog_key,
        "content_sha256": content_sha256,
        "title": args.title.strip() if args.title else book.stem,
        "author": args.author.strip(),
        "format": book_format,
        "byte_size": byte_size,
    }
    if language:
        metadata["language"] = language

    prepared = request_json(
        f"{base_url}/v2/admin/catalog/books/uploads",
        token=token,
        body=json.dumps(metadata, ensure_ascii=False).encode("utf-8"),
        timeout=args.timeout,
    )
    print_response("Загрузка книги подготовлена:", prepared)

    if prepared.get("upload_required") is True:
        with book.open("rb") as source:
            uploaded = request_json(
                admin_url(base_url, prepared.get("upload_path")),
                token=token,
                content_type=FORMATS[book_format],
                body=source.read(),
                timeout=args.timeout,
            )
        print_response("Файл книги загружен:", uploaded)

        completed = request_json(
            admin_url(base_url, prepared.get("complete_path")),
            token=token,
            body=b"{}",
            timeout=args.timeout,
        )
        print_response("Обработка книги поставлена в очередь:", completed)
        print(
            f"\nКнига: job_id={completed.get('job_id') or 'не указан'}, "
            f"status={completed.get('job_status') or completed.get('generation_status') or 'не указан'}"
        )
    else:
        print("\nФайл с таким catalog_key и SHA-256 уже загружен; повторная отправка не требуется.")

    if cover:
        cover_metadata = {
            "content_sha256": file_sha256(cover),
            "mime_type": cover_mime_type,
            "byte_size": cover.stat().st_size,
        }
        cover_prepared = request_json(
            f"{base_url}/v2/admin/catalog/books/{prepared['book_edition_id']}/cover/uploads",
            token=token,
            body=json.dumps(cover_metadata).encode("utf-8"),
            timeout=args.timeout,
        )
        print_response("Загрузка обложки подготовлена:", cover_prepared)
        if cover_prepared.get("upload_required") is True:
            with cover.open("rb") as source:
                request_json(
                    admin_url(base_url, cover_prepared.get("upload_path")),
                    token=token,
                    content_type=cover_mime_type,
                    body=source.read(),
                    timeout=args.timeout,
                )
            cover_completed = request_json(
                admin_url(base_url, cover_prepared.get("complete_path")),
                token=token,
                body=b"{}",
                timeout=args.timeout,
            )
            print_response("Обложка сохранена:", cover_completed)
        else:
            print("\nТакая обложка уже находится в хранилище.")


if __name__ == "__main__":
    try:
        upload()
    except KeyboardInterrupt:
        print("\nОперация отменена.", file=sys.stderr)
        raise SystemExit(130)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        raise SystemExit(1)
