# Book catalog language contract

The catalog read routes require the existing installation bearer token.
Language is a base ISO code. This contract currently exposes catalog categories
`ru` and `en`.

## Backward-compatible catalog

`GET /v2/books/catalog?limit=24&cursor=<opaque>` keeps its existing response and
pagination semantics. The only addition to every book object is:

```json
{
  "language": "ru"
}
```

The value is `"ru"`, `"en"`, another normalized base language code, or `null`.
Clients must treat `null` and an absent field as unknown. Existing clients may
ignore the additive field.

## Catalog category by language

Use `GET /v2/books/catalog/languages/ru?limit=24` for Russian books and
`GET /v2/books/catalog/languages/en?limit=24` for English books.

```json
{
  "contract_version": "book-catalog-language-v1",
  "language": "en",
  "items": [
    {
      "resolution": "catalog",
      "book_edition_id": "123e4567-e89b-42d3-a456-426614174000",
      "catalog_key": "narra-en-example",
      "title": "Example",
      "author": "Author",
      "genres": ["literary-fiction"],
      "language": "en",
      "format": "epub",
      "content_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "generation_status": "base_ready",
      "ready": true,
      "source_download_path": "/v2/books/123e4567-e89b-42d3-a456-426614174000/source/download"
    }
  ],
  "next_cursor": null
}
```

`limit` is optional and accepts `1..100`; the default is `20`. Pass
`next_cursor` unchanged as the next request's `cursor`. The cursor is opaque and
bound to the response language: using an English cursor on the Russian route,
or vice versa, returns HTTP 400.

The endpoint returns only ready catalog editions (`base_ready` or `published`).
Unsupported categories return HTTP 400.

## Future catalog and user books

The existing catalog prepare request accepts an optional nullable `language`:

```json
{
  "catalog_key": "narra-en-example",
  "content_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "title": "Example",
  "author": "Author",
  "format": "epub",
  "byte_size": 42,
  "language": "en-US"
}
```

This admin request continues to require the independent catalog-ingest token.

The existing private registration request `POST /v2/books/local` accepts the
same optional field. The backend normalizes both examples to `"en"`. Omitting
the field keeps old request bodies valid and does not erase a language already
stored for that edition.

All existing book-binding responses add `language` as a nullable field. New
catalog upload tools send the manifest language and infer `ru`/`en` from the
standard `narra-ru-` and `narra-en-` keys when an old manifest omits it.
