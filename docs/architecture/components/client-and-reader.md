---
type: component
status: current
scope: ReadAny clients, Narra mobile shell and embedded reader
last-reviewed: 2026-09-07
---

# Клиенты и reader runtime

## Ответственность

Клиентский контур хранит библиотеку и пользовательское состояние локально,
открывает разные форматы книг, связывает книгу с backend edition и показывает
серверное обогащение без блокировки базового чтения. Основной продукт Narra —
[`packages/app-expo`](../../../packages/app-expo); desktop ReadAny находится в
[`packages/app`](../../../packages/app), а общий домен — в
[`packages/core`](../../../packages/core).

## Уровни fork-а и компоненты

```mermaid
flowchart TB
    Screens[Narra screens and flows] --> Stores[Expo stores / coordinators]
    Screens --> Shared[@readany/core]
    Stores --> Gateway[backend-book / AI / media clients]
    Stores --> Bridge[use-reader-bridge]
    Shared --> DB[platform DB / file / sync adapters]
    Bridge <--> HTML[generated reader.html]
    HTML --> Foliate[workspace foliate-js fork]
    Foliate --> Parsers[EPUB / MOBI-KF8 / FB2 / CBZ / PDF]
```

### ReadAny base

`@readany/core` определяет общие типы книги и чата, import helpers, SQLite
repositories, knowledge/RAG, AI agent/tools, sync, statistics, TTS и reader
abstractions. Desktop импортирует core напрямую и использует React/Vite/Tauri.
Это local-first основание проекта: базовое чтение и локальные данные не требуют
Narra Gateway.

### Narra layer

Expo-приложение добавляет catalog/private backend binding, персонажей и
anti-spoiler projection, чат персонажа, Narra assistant gateway, durable media,
multi-voice UI и scene slots. Состояние разделено между core stores и
mobile-specific stores/coordinators; сетевые ошибки обогащения не должны
ломать локальную книгу.

### React Native и Foliate

React Native не рендерит EPUB-текст собственными views. Скрипт
[`scripts/build-reader.js`](../../../packages/app-expo/scripts/build-reader.js)
собирает `foliate-js`, matcher имён и scene pixel loader в self-contained
`assets/reader/reader.html`; PDF engine выносится в отдельный lazy asset.
Runtime поднимает локальный HTTP/range server и грузит HTML в WebView.

[`foliate-js`](../../../packages/foliate-js) — workspace fork upstream
browser-library. Он отвечает за parsing, CFI/navigation, fixed/reflowable layout,
pagination, overlays, search и извлечение текста. Продуктовые панели, backend
binding и AI находятся выше этой библиотеки.

## RN ↔ WebView contract

[`use-reader-bridge.ts`](../../../packages/app-expo/src/hooks/use-reader-bridge.ts)
скрывает двунаправленный `injectJavaScript` /
`window.ReactNativeWebView.postMessage` протокол.

RN отправляет, среди прочего:

- open book с URI/base64, MIME, last location и layout settings;
- navigation/search/annotation команды;
- запросы видимого текста, reading context, TTS-сегментов и абзацев главы;
- character names/overlays, translation и состояние scene slot;
- CFI highlight для TTS.

WebView возвращает:

- lifecycle `foliate-loaded`, ready/loaded/error;
- relocate с fraction, section/page, CFI и text snippet;
- selection/tap, TOC и search results;
- видимый текст и TTS/paragraph request responses;
- character tap и scene-slot tap/restore.

Запросы, ожидающие ответ WebView, имеют request id, timeout и безопасное
fallback-значение. При смене книги pending requests отменяются, чтобы поздний
ответ старой WebView-сессии не попал в новую книгу.

## Импорт и привязка

### Собственная книга

После проверки, нормализации имени/кодировки, извлечения метаданных и записи
файла Expo сначала фиксирует локальную книгу. Только затем для новой книги
запускаются независимые best-effort задачи:

1. [`startImportedBackendBook`](../../../packages/app-expo/src/lib/narra/backend-book-sync.ts)
   вычисляет/использует SHA-256 и делает `POST /v2/books/resolve` с
   `source=local`.
2. Если edition ещё нет, `POST /v2/books/local` создаёт private binding из
   `{content_sha256,title,author,format,language}`.
3. `PUT /v2/books/:edition/source` передаёт исходные bytes. Gateway проверяет
   hash и сохраняет объект под private subject; затем обеспечивает identity и
   analysis.
4. Клиент опрашивает progress/manifest/preview/media. Незавершённая сессия
   возобновляется после hydration/relaunch.

Private backend analysis принимает `epub`, `fb2`, `fbz`, `txt`, `pdf`; FBZ
распаковывается до проверенного FB2, а сохранённый после mobile conversion UMD
передаётся как EPUB. MOBI/AZW/CBZ могут читаться локально, но не отправляются в
этот private analysis contract без поддерживаемого производного source.

Дубликат уже известной локальной книги не запускает повторно backend upload,
cover generation или automatic vectorization.

### Каталог

Catalog item уже содержит `book_edition_id`. Клиент скачивает source через
backend content contract, проверяет и сохраняет его локально, затем открывает
той же reader machinery. Он не меняет shared catalog source и не превращает
его в private upload. Cover и canonical character media скачиваются из
backend; отсутствие media деградирует UI, но не чтение.

## Автоматические и явные действия

| Действие | Автоматически | Требует пользователя/оператора |
| --- | --- | --- |
| Локальный commit импортированного файла | после выбора/получения файла | пользователь выбирает импорт, WebDAV или catalog item |
| Private backend bind/upload/analysis | после успешного нового локального commit | настройка backend/auth; retry анализа доступен явно |
| Private cover | после импорта, если embedded/catalog cover не найден | пользователь может заменить/regenerate в доступном UI |
| Local RAG | после импорта только при включённых model/capability/auto flag | включение модели, ручная индексация/reindex |
| Catalog analysis/media | нет со стороны клиента | operator ingest/retry/backfill; backend workers выполняют очередь |
| TTS playback | нет | пользователь нажимает «Слушать» |
| Inline scene | никогда не ставится от открытия/progress | пользователь нажимает slot; operator может запустить backfill |

## Runtime invariants

- Ключ состояния reader — локальный book id плюс актуальная session/load id;
  backend identity хранится отдельно как `book_edition_id`.
- CFI — клиентская навигационная координата; server canonical analysis
  использует offsets в normalized text. Их нельзя смешивать без projection.
- Ready reader не зависит от готовности markup, portrait, RAG или TTS sidecar.
- Catalog и private книги проходят одну rendering machinery, но имеют разные
  ownership/upload/media rules.
- Поздний network/WebView callback должен быть привязан к исходной session и
  отбрасываться после закрытия/замены книги.

## Известные ограничения

- Документ `native-expo-reader-migration-plan` предлагал убрать Foliate/WebView
  для каталога, но этот target state не реализован: текущий catalog reader тоже
  использует WebView/Foliate.
- PDF engine загружается лениво, но остаётся частью WebView reader; возможности
  text layer/CFI отличаются от EPUB.
- Серверные offsets и EPUB CFI не имеют общего публичного точного контракта;
  scene-at принимает progress/reader offset и разрешает anchor на сервере.
