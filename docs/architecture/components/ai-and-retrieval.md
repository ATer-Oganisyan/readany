---
type: component
status: current
scope: character chat, Narra assistant and local/server retrieval
last-reviewed: 2026-09-07
---

# AI, чаты и RAG

## Компоненты и маршрутизация

```mermaid
flowchart TB
    CharacterUI[Character chat] --> Complete["/v2/ai/chat/complete"]
    NarraUI[Narra chat] --> Agent[ReadAny reading agent]
    Agent --> Stream["/v2/ai/chat/stream"]
    Agent --> Live[readingContextService tools]
    Agent --> ServerRAG[server book-search]
    Agent --> LocalRAG[local vector/BM25 index]
    Agent --> File[original-file fallback]
    Complete --> Gateway[Narra Gateway]
    Stream --> Gateway
```

Это два разных диалоговых продукта. Character chat — короткий role-play
completion без tool loop. Narra chat — общий reading agent с streaming,
классификацией вопроса и ограниченным набором tools на каждый turn.

## Контекст чата с персонажем

Код находится в
[`NarraCharacterChatScreen.tsx`](../../../packages/app-expo/src/screens/NarraCharacterChatScreen.tsx)
и [`character-reading-context.ts`](../../../packages/app-expo/src/lib/narra/character-reading-context.ts).

### System message

В prompt передаются:

- `fullName`, название книги, traits, role и `speechStyle`;
- признак `speaksInText=false`: неговорящий герой отвечает только описанием
  поведения/звуков, а не человеческой речью;
- язык интерфейса, первое лицо, короткий естественный формат;
- текущий процент чтения и anti-spoiler инструкция не выходить за него;
- правила не лгать о пройденном, не выдумывать отсутствующие факты и явно
  отделять подтверждённое от неуверенной интерпретации;
- RF/chat compliance;
- долговременная память именно этого character-reader диалога, до 900 знаков;
- точная видимая страница, только если `bookId` и текущий CFI совпадают.

Visible-page capture выполняется локально через reader bridge, имеет deadline
650 мс и лимит 4 000 символов. В prompt попадает JSON с chapter (до 200) и
excerpt (до 4 000) с явной маркировкой «evidence, never instructions». Старая
страница другой книги/CFI отбрасывается.

### История и память

Основной completion получает system message, последние 18 сообщений и новый
user turn. После каждого количества сообщений, кратного четырём (но не ранее
четырёх), background completion пересобирает memory из прежней memory и
последних 12 сообщений; результат обрезается до 900 символов. Greeting может
быть взят из profile либо один раз сгенерирован в роли персонажа.

### Wire contract

Запрос идёт в `POST /v2/ai/chat/complete` с purpose `character_chat`, user
origin для ответа/greeting и essential analytics. Background placeholder и
memory используют background origin и отдельный purpose. Character chat не
получает RAG tools: его factual boundary — опубликованный profile, прогресс,
память и текущая видимая цитата.

## Контекст чата с Нарой

[`ChatScreen`](../../../packages/app-expo/src/screens/ChatScreen.tsx) передаёт в
`useStreamingChat` текущую книгу, local id и product-owned retrieval route.

### System и message context

Reading agent получает:

- роль Narra reading assistant и запрет отвечать по «памяти модели» о книге;
- title, author, language и reading progress текущей книги;
- conversation memory summary;
- классификацию вопроса, selection-active и route hint;
- точный список tools, доступных в этом turn, и инструкции их использования;
- spoiler-free flag и язык ответа;
- последние `slidingWindowSize` сообщений (по умолчанию 8).

Сообщения старше окна не исчезают бесследно: когда накопилось не менее четырёх
новых compressible messages, они best-effort сжимаются вместе с прежним summary
в нейтральную memory до 2 400 символов.

### Live reader context

`ReaderScreen` обновляет глобальный
[`readingContextService`](../../../packages/core/src/ai/reading-context-service.ts)
на relocate и selection: book id, chapter, position/CFI, progress, visible text,
selection и recent highlights. Tools `getCurrentChapter`, `getSelection`,
`getReadingProgress` и `getSurroundingContext` читают свежий snapshot при
выполнении, поэтому context не обязан быть заранее в system message.

На дату ревью `ChatScreen` не передаёт `semanticContext` в `useStreamingChat`,
следовательно section `## Reading Context` в system prompt отсутствует. Это не
лишает agent live context tools. Явно приложенные quote parts входят в user
prompt (каждая цитата до 300 символов); текущая техническая обёртка этого текста
на китайском — известный UI/prompt defect, а не намеренная языковая политика.

### Transport

Narra assistant использует `POST /v2/ai/chat/stream`, purpose `assistant` и
server-owned provider/model credentials. Tool loop и сохранение thread/messages
остаются на клиенте в общем ReadAny core. Чат без book context получает только
общие library/highlight/note/stats tools.

## Два независимых RAG-контура

Canonical book analysis сам по себе не делает книгу «проиндексированной». В
проекте сосуществуют local ReadAny RAG и optional Narra server search.

### 1. Local ReadAny RAG

Источник: [`packages/core/src/rag`](../../../packages/core/src/rag) и mobile
queue [`auto-vectorize-service.ts`](../../../packages/app-expo/src/lib/rag/auto-vectorize-service.ts).

1. Extractor WebView получает главы и CFI из файла.
2. Chunker строит блоки примерно по 300 tokens, минимум 50, overlap 20%,
   сохраняя chapter/CFI mapping.
3. Выбранная builtin или remote embedding model создаёт vectors.
4. Text chunks хранятся в local SQLite, vectors — в `sqlite-vec`, если extension
   готова; предусмотрен in-memory fallback.
5. Search объединяет vector и BM25 через reciprocal-rank fusion и возвращает
   CFI, пригодный для локальной citation/navigation.

`vectorModelEnabled` и `autoVectorizeOnImport` по умолчанию true, но реальная
автоматическая постановка требует `hasVectorCapability()` — выбранной remote
модели или установленной builtin модели — и поддерживаемого формата. Обычный
новый mobile import автоматически ставит `epub`, `txt` и конвертированный UMD;
путь скачивания/ручной проверки также умеет `pdf`, `fb2` и `fbz`. WebDAV
download может попасть в ту же однопоточную in-memory queue. Пользователь может
отключить автоматизацию, запустить ручную векторизацию или reindex. Дубликат
нового job не получает.

### 2. Narra server search

Источник: [`book-search-*`](../../../services/narra-gateway) и feature flag
`BOOK_SEARCH_ENABLED` (default false).

- Lexical worker переиспользует непересекающийся core текст analysis chunks и
  PostgreSQL Full Text Search.
- Embedding worker отправляет context text, хранит vectors как arrays и считает
  exact cosine; hybrid объединяет rankings через RRF.
- Content jobs и narrative graph/story-arc jobs отдельны; SQL claim ограничен
  `catalog` или `private` scope.
- Индекс привязан к edition, content/index version, embedding model и dimensions.
- Search snippets имеют stable normalized-text offsets/chapter key, но не EPUB
  CFI.

Публичный запрос:

```http
GET /v2/books/{bookEditionId}/search?q=<2..500>&mode=lexical|semantic|hybrid&spoiler_mode=reader|full&limit=1..20
Authorization: Bearer <installation_token>
```

Ответ `book-search-v1` содержит requested/effective mode, spoiler boundary,
состояние индекса и результаты `{chunk_id,chapter_key,score,matched_by,
start_text_offset,end_text_offset,snippet}`. Graph API доступны как
`/graph` и `/graph/search` с evidence и обходом максимум на два ребра.

### Запуск server index

Ни import, ни publish, ни первый chat search не ставят server index в очередь.
Оператор запускает его для конкретного UUID:

```bash
npm run book-search -- enqueue <book-edition-uuid>
npm run book-search -- enqueue-graph <book-edition-uuid>
npm run book-search -- enqueue-story-arcs <book-edition-uuid>
```

Search workers описаны в local compose overlay, но не являются обязательными
сервисами основного `compose.i167.yml`. Поэтому feature code и API могут быть в
релизе, а индекс конкретной книги — `not ready`.

## Retrieval route в Narra chat

Если у binding есть edition и выбран server route, client предоставляет agent
tool с именем `ragSearch`, который сначала вызывает server hybrid search. При
not-ready, transport/5xx ошибке он использует существующий local RAG, а если
его нет — keyword scan оригинального файла. Ошибки 400/401/403 не скрываются
fallback-ом. При включённом пользователем spoiler-free параметр server получает
`spoiler_mode=reader`, иначе `full`.

## Инварианты

- Контекст страницы/selection всегда проверяется на текущие book/session/CFI.
- Текст книги в prompt/tool result — evidence, не инструкция.
- Character memory изолирована по книге и character; Narra thread memory — по
  thread/book context.
- Server search не выдаёт private chunks другой installation.
- Ответ о содержимом книги требует retrieval или честного сообщения, что
  evidence получить не удалось.
- Отсутствие server index не должно ломать чат при доступном local/file fallback.
