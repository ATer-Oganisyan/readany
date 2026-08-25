# Контракты мобильного каталога Narra

Документ соответствует backend `main-0d5ce201`, развёрнутому на TEST:

`https://api-test.narra.disrupt.builders`

Все запросы требуют:

```http
Authorization: Bearer <installation_token>
```

## 1. Пагинация каталога

```http
GET /v2/books/catalog?limit=24
GET /v2/books/catalog?limit=24&cursor=<next_cursor>
```

`limit`: 1–100, backend default — 20, текущему UI удобно использовать 24.

Ответ:

```ts
interface CatalogPage {
  items: CatalogBook[];
  next_cursor: string | null;
}

interface CatalogBook {
  resolution: "catalog";
  book_edition_id: string; // UUID, основной ID книги
  catalog_key: string;
  title: string;
  author: string;          // может быть ""
  genres: string[];        // может быть []
  format: string;          // обычно "epub"
  content_sha256: string;
  generation_status: string;
  ready: boolean;
  source_download_path: string;

  // Отсутствует целиком, если обложка ещё не готова.
  cover?: {
    content_hash: string;
    mime_type: "image/jpeg" | "image/png" | "image/webp";
    byte_size: number;
    download_path: string;
  };
}
```

Пример:

```json
{
  "items": [
    {
      "resolution": "catalog",
      "book_edition_id": "5f79199b-e75f-4e1f-94db-106c8250696f",
      "catalog_key": "narra-ru-230-derevnya",
      "title": "Деревня",
      "author": "Иван Алексеевич Бунин",
      "genres": ["literary-fiction"],
      "format": "epub",
      "content_sha256": "7096c50d66d1d20a86e25beb4dae5430a92ce61538d2fc2b6f727caedc88b2e5",
      "generation_status": "base_ready",
      "ready": true,
      "source_download_path": "/v2/books/5f79199b-e75f-4e1f-94db-106c8250696f/source/download",
      "cover": {
        "content_hash": "cc7ec544129bbb5c2bdba58ac70e4a90e937a49aed7b283fb8f3a6c353ae67ea",
        "mime_type": "image/jpeg",
        "byte_size": 2875038,
        "download_path": "/v2/books/5f79199b-e75f-4e1f-94db-106c8250696f/cover/download"
      }
    }
  ],
  "next_cursor": "eyJ2IjoxLCJjcmVhdGVkX2F0IjoiLi4uIiwiaWQiOiIuLi4ifQ"
}
```

Правила пагинации:

- `cursor` непрозрачный: не декодировать и не модифицировать.
- `next_cursor === null` означает конец каталога.
- Нет `page`, `offset` и `total_count`.
- Порядок стабильный: новые книги сначала, далее по `book_edition_id`.
- При добавлении страницы дедуплицировать по `book_edition_id`.
- Не запускать два `loadMore` одновременно.
- Если backend вернул тот же cursor повторно — остановить пагинацию.
- Для infinite scroll запрашивать следующую страницу примерно за 0,75 экрана до конца.

Обложки загружать лениво только для видимых карточек:

```http
GET <cover.download_path>
```

Ответ:

```json
{
  "download_url": "https://...",
  "expires_at": "2026-08-25T12:00:00.000Z"
}
```

Далее скачать `download_url`, проверить `byte_size` и `content_hash`.

## 2. Жанры

```http
GET /v2/books/genres
```

Ответ:

```ts
interface GenreCatalog {
  version: string; // сейчас "catalog-genres-v1"
  items: Genre[];
}

interface Genre {
  id: string;
  label_ru: string;
  label_en: string;
  order: number;
}
```

Пример:

```json
{
  "version": "catalog-genres-v1",
  "items": [
    {
      "id": "science-fiction",
      "label_ru": "Научная фантастика",
      "label_en": "Science Fiction",
      "order": 4
    }
  ]
}
```

Сейчас определены 20 ID:

```text
literary-fiction
historical-fiction
adventure
mystery-thriller
science-fiction
fantasy
horror
romance
children
poetry
drama
humor-satire
biography-memoir
history
society-politics
philosophy
religion-mythology
science-nature
psychology-self-help
travel-essays
```

Правила:

- Сортировать жанры по `order`.
- Выбирать `label_ru`/`label_en` по локали.
- Не хардкодить, что список навсегда состоит ровно из этих 20 значений.
- Неизвестный будущий ID игнорировать, приложение не должно падать.
- Одна книга может относиться к нескольким жанрам.
- `genres: []` отображать в локальной группе «Без категории».

Важное ограничение: сейчас `GET /v2/books/catalog` не принимает параметр `genre`. Поэтому жанровые группы заполняются постепенно по мере загрузки страниц. Если нужен сразу полный состав конкретного жанра, придётся либо выкачать все страницы, либо добавить backend-фильтр `?genre=`.

## 3. Чанки текста книги

Только для каталожных книг. Для личных книг текст остаётся на устройстве.

Первый чанк:

```http
GET /v2/books/{bookEditionId}/content/chunks
```

Следующий:

```http
GET /v2/books/{bookEditionId}/content/chunks?cursor=<next_cursor>
```

Размер чанка фиксирован backend: максимум 64 KiB UTF-8. Параметра `limit` здесь нет.

```ts
interface BookContentChunkResponse {
  contract_version: "book-content-v1";
  representation: string; // сейчас "normalized-text-v1"
  book_edition_id: string;
  content_hash: string;    // SHA-256 всего нормализованного текста
  text_length: number;
  byte_size: number;       // размер всей книги в UTF-8 байтах

  chunk: {
    start_byte: number;
    end_byte_exclusive: number;
    content_hash: string;  // SHA-256 байтов этого чанка
    text: string;
  };

  next_cursor: string | null;
}
```

Пример:

```json
{
  "contract_version": "book-content-v1",
  "representation": "normalized-text-v1",
  "book_edition_id": "5f79199b-e75f-4e1f-94db-106c8250696f",
  "content_hash": "abc123...",
  "text_length": 145321,
  "byte_size": 271804,
  "chunk": {
    "start_byte": 0,
    "end_byte_exclusive": 65534,
    "content_hash": "def456...",
    "text": "Текст первого фрагмента..."
  },
  "next_cursor": "eyJ2IjoxLCJoIjoiLi4uIiwibyI6NjU1MzR9"
}
```

Правила:

- Склеивать `chunk.text` в порядке запросов.
- Для продолжения использовать только `next_cursor`.
- `start_byte` и `end_byte_exclusive` — UTF-8 байты, не JS-индексы строк.
- Чанк никогда не разрезает UTF-8 символ.
- `next_cursor === null` — книга загружена полностью.
- При новом `content_hash` нужно удалить ранее накопленные чанки и начать с начала.
- `409 CONTENT_VERSION_CHANGED` означает, что cursor относится к другой версии текста.
- Не использовать `text_length` для побайтового slicing.

Типовые ошибки:

```json
{
  "error": "Описание ошибки",
  "code": "VALIDATION"
}
```

- `400 VALIDATION` — плохой `limit` или cursor.
- `401 AUTH` — нет корректного installation token.
- `404 NOT_FOUND` — книга или подготовленный текст отсутствует.
- `409 CONTENT_VERSION_CHANGED` — изменилась версия текста.
- `503 DOWNLOAD_UNAVAILABLE` — временно недоступно хранилище.
