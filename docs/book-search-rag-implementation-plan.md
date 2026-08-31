# Narra: локальный план поиска и narrative graph

## Границы текущей работы

- Реализация выполняется только локально в ветке `codex/book-search-backend`.
- Серверы, TEST и production не изменяются.
- Массовая индексация и автоматический backfill запрещены.
- Индекс создаётся только явной командой для одной книги.
- Внедрение, `pgvector/HNSW`, canary и backfill остаются отдельным этапом.

## Текущий локальный вертикальный срез

1. Независимые durable jobs `lexical` и `embedding` с claim/lease/retry.
2. Переиспользование `book_analysis_chunks` и нормализованного текста.
3. PostgreSQL Full Text Search для lexical search.
4. Точный cosine search по массивам embeddings в пределах одной книги.
5. Reciprocal Rank Fusion для hybrid ranking.
6. `/v2/books/:bookEditionId/search` со spoiler-фильтрацией по позиции читателя.
7. `/v2/books/:bookEditionId/graph/search` объединяет text seeds, сущности и
   ограниченный обход графа на 1–2 ребра.
8. Content и narrative jobs выполняются разными контейнерами, жёстко
   ограниченными `catalog` либо `private` scope на уровне SQL claim.
9. Учёт embedding usage по книге, индексу и job.
10. Feature flag; нет автопостановки книг в очередь.

После `prepare` существующие chunks уже содержат стабильные core/context offsets,
chapter key, content hash и UTF-8 byte ranges. Lexical worker сохраняет только
непересекающийся core-текст; embedding worker отправляет context-текст. Поэтому
повторный chunking не нужен, citations не дублируются из-за overlap, а jobs
остаются идемпотентными.

## Последовательность

| Этап | Результат | Статус |
|---|---|---|
| 0 | Контракты, таблицы jobs/index/usage | реализовано локально |
| 1 | Одиночная постановка книги и workers | реализовано локально |
| 2 | Hybrid Search API и spoiler guard | реализовано локально |
| 3 | Narrative graph из готовой опубликованной разметки | реализовано локально |
| 4 | Детерминированные story arcs по связанным событиям | реализовано локально |
| 5 | Query-aware graph retrieval с evidence для RAG | реализовано локально |
| 6 | Генеративное улучшение story arcs и финальные RAG-ответы | следующий слой |
| 7 | Локальная evaluation на выбранных книгах | отдельно, без массового запуска |
| 8 | Внедрение `pgvector/HNSW`, canary/backfill | отдельная будущая задача |

## Тесты

- unit: ranges, integrity, cosine, RRF, validation и fallback;
- repository: idempotency, claim/lease/retry и частичная готовность;
- API contract: auth boundary, режимы поиска, offsets и spoilers;
- PostgreSQL integration: миграция, GIN/FTS и повторная индексация;
- локальный E2E запускается только явно для одной выбранной книги.

## Зависимости и стоимость

Новая npm-библиотека не нужна: PostgreSQL FTS встроен, HTTP-вызов embeddings
выполняется стандартным `fetch`. В текущем локальном этапе нет генеративного
LLM: дополнительные запросы нужны только к embedding API при индексации чанков
и при semantic/hybrid query. Narrative graph из observations также не требует
LLM. Генеративные `storyArcs` и RAG-ответ добавляются отдельно и получают
собственный cost budget.

## Явный локальный запуск для одной книги

После настройки `DATABASE_URL`, object storage и `BOOK_EMBEDDING_*`:

```bash
npm run book-search -- enqueue <book-edition-uuid>
npm run worker:book-search
npm run book-search -- enqueue-graph <book-edition-uuid>
```

Команды не перечисляют каталог и не создают задания для других книг. Graph и
story arcs читают уже готовую разметку и не вызывают LLM. Baseline story arcs
объединяет события по общим персонажам; генеративная редактура качества остаётся
явно отделённой будущей возможностью. После успешного graph job story-arc job
ставится автоматически для того же индекса. Команда `enqueue-story-arcs`
остаётся для диагностики и явного повторного запуска.

## Изолированные локальные контейнеры

| Контейнер | Jobs | Scope | Compose profile |
|---|---|---|---|
| `book-search-catalog` | `lexical,embedding` | `catalog` | `search-catalog` |
| `book-search-private` | `lexical,embedding` | `private` | `search-private` |
| `book-narrative-catalog` | `graph,story_arc` | `catalog` | `narrative-catalog` |
| `book-narrative-private` | `graph,story_arc` | `private` | `narrative-private` |

Narrative-контейнеру нужны только PostgreSQL и Gateway readiness: у него нет
credentials к MinIO и embedding endpoint. Остановка контейнера не удаляет jobs —
они остаются в durable queue до включения соответствующего scope.

Для пользовательских книг локально:

```bash
docker compose \
  -f compose.book-analysis-local.yml \
  -f compose.book-search-local.yml \
  --profile search-private \
  --profile narrative-private \
  up -d book-search-private book-narrative-private
```

Для каталога используются профили `search-catalog` и `narrative-catalog`.
Контуры выключаются независимо через `docker compose stop <service>`.

## Query-aware graph retrieval

`GET /v2/books/:bookEditionId/graph/search` принимает `q`, `mode`,
`spoiler_mode`, `limit` и `max_hops=1|2`. Backend:

1. получает BM25/vector seeds;
2. ранжирует узлы по canonical name, aliases и описанию;
3. добавляет отношения/события, чьи evidence ranges совпали с text seeds;
4. выполняет ограниченный обход на 1–2 ребра;
5. возвращает subgraph, story arcs, observations и цитаты.

Во всех чтениях действует серверная граница
`evidence_end_offset <= reader_text_offset`. Полный снимок доступен только через
явный `spoiler_mode=full`.
