# Предгенерация сцен каталога: топ‑100 и дальнейший prefetch

Дата: 31 августа 2026 г.

## Цель

Для первых 100 книг каталога первая глава должна быть готова к моменту открытия
книги в мобильном приложении. Дальше сцены создаются заранее только для
каталога: backend получает прогресс чтения всех пользователей, берёт максимум
и с задержкой ставит в очередь следующую главу. Личные книги остаются
on-demand: сцена личной книги создаётся только после явного действия владельца.

Граница каталога определяется не по названию или локальному файлу, а по
`resolution=catalog` и `book_edition_id`. Рейтинг берётся из
`catalog_book_popularity.popularity_rank`; это тот же детерминированный порядок,
который был построен из `полный-каталог-512-книг.md`.

## Что уже обнаружено на fun1

- активный сервер — `fun1` (SSH-алиас `fun1`, hostname `fv4c3lbgceendevin970`);
- в рейтинге сейчас сопоставлено 99 активных изданий из 100;
- книга с рангом №1 «Война и мир» находится в `marking_up`, поэтому у неё ещё
  нет опубликованной v3-разметки и канонического текста для scene worker;
- до кампании в очереди было 9 446 `scene_image` jobs (`7 577 failed`,
  `1 953` из них относятся к топ‑100, `4 304 queued` относятся к топ‑100,
  `97 ready` по всему каталогу);
- старый backlog нельзя запускать общим worker: он содержит сцены за пределами
  первой главы.

### Провайдер изображений

Сцены должны идти через настроенный image-route LiteLLM с моделью
`openai/gpt-image-2`: `LITELLM_BASE_URL=https://lm.multitool.works` и
`LITELLM_IMAGE_MODEL=openai/gpt-image-2`. В gateway сцена использует тот же
конфигурируемый route, что и обложки, с форматом `4:3`; прямой вызов старого
`GigaChat Image` для сцен запрещён. Bootstrap-кампания запускается только после
успешного пробного запроса этой модели.

## Канонический поток для мобильного приложения

```text
читатель открыл каталог
        │
        ├─ manifest/content: только чтение, очередь не меняется
        │
        ├─ сцена уже ready?
        │       ├─ да → получить signed URL → скачать → проверить файл → показать
        │       └─ нет → POST /scenes/at → 202 → polling того же слота
        │
        └─ фактический прогресс каталога → debounce/outbox → POST /progress
                                              ↓
                                backend max(progress всех readers)
                                              ↓ (задержка + checkpoint)
                                  durable scene_image jobs следующей главы
```

### Инварианты

1. `GET manifest`, открытие книги и обычный `POST /progress` сами по себе не
   создают сцену. Для prefetch есть отдельный backend coalescer с явным
   checkpoint.
2. Backend — единственный владелец нормализованного текста, scene policy,
   prompt, provider/model, durable job и asset. Клиент передаёт только
   `bookEditionId` и снимок позиции.
3. Backend-сцена уникальна по
   `bookEditionId + markupContentHash + policyVersion + slotIndex`.
   Идемпотентность реализуется существующим `generation_jobs.idempotency_key` и
   `book_scene_slots (markup_version_id, slot_index)`.
4. Готовый asset всегда возвращается как короткоживущий signed URL. Клиент
   считает его готовым только после успешного сохранения непустого локального
   файла.
5. После начала polling позиция фиксируется. Перелистывание текста не меняет
   slot у уже запущенной операции.
6. Если `bookEditionId` отсутствует, используется только legacy on-demand путь
   личной книги; ошибка backend-сцены не должна незаметно запускать вторую
   генерацию по выделенному тексту.

## Доработка мобильного клиента

### Сцена

В store нужно разделить две сущности:

```text
scenesByBackendId[bookEditionId:markupIdentity:sceneKey]
sceneAnchorBindings[cfiAnchor] -> backendId
```

CFI — это только место отображения. Дедупликация, registry активных Promise,
polling и локальный asset выполняются по `backendId`, а не по CFI или номеру
страницы. Два anchor, попавшие в один 6000-символьный backend slot, должны
присоединиться к одной операции и иметь одну видимую inline-врезку.

При hydration:

1. проверить совпадение `bookEditionId` и `markupIdentity`;
2. сгруппировать старые записи по backend id;
3. детерминированно оставить один anchor и один файл;
4. удалить/скрыть остальные bridge-врезки.

При нажатии «Показать сцену» клиент сохраняет `requestedProgress`, задаёт
wall-clock deadline пять минут, повторяет тот же запрос
`POST /v2/books/{id}/scenes/at` и скачивает signed URL сразу после `200 ready`.
После проверки размера файла запись попадает в store и WebView. При восстановлении
готовая запись только читается — новый job не создаётся.

### Прогресс

Отправлять прогресс только для каталожной книги, после реального перемещения
читателя, с debounce (например, 2–5 секунд) и локальным offline outbox. Событие
содержит `bookEditionId` и один из канонических вариантов:

```json
{
  "progress_fraction": 0.25,
  "text_offset": 12345,
  "chapter_key": "toc:nav:2",
  "section_index": 1,
  "section_fraction": 0.25
}
```

Поля позиции монотонны: возврат назад, смена размера шрифта, повторная доставка
или перемешивание данных не уменьшают сохранённый прогресс. Внутри одной
операции polling используется snapshot, а не mutable `progressRef`.

## Backend prefetch для каталога

Существующий `reader_book_positions` хранит позицию каждого пользователя и
остаётся источником событий. Поверх него нужна отдельная агрегированная модель:

```text
catalog_reading_frontiers(
  book_edition_id PRIMARY KEY,
  max_text_offset,
  max_chapter_index,
  max_chapter_fraction,
  source_subject_id,
  updated_at,
  next_prefetch_at
)
catalog_prefetch_checkpoints(
  book_edition_id,
  chapter_index,
  threshold,              -- сейчас 0.25
  enqueued_at,
  UNIQUE(book_edition_id, chapter_index, threshold)
)
```

Транзакция `POST /progress` делает upsert позиции пользователя, затем обновляет
frontier только через `GREATEST`/лексикографическое сравнение
`(chapter_index, chapter_fraction, text_offset)`. Отдельный coalescer с задержкой
читает frontier и, когда достигнут `25%` текущей главы, один раз создаёт jobs
следующей главы. Повторные события, несколько пользователей и повторный запуск
coalescer не дают новых jobs благодаря checkpoint и ключу слота.

Для главы берутся offsets из `content_navigation`/`sections`, а не из позиции
WebView. Если оглавление не даёт надёжной границы, coalescer не угадывает всю
книгу: он ставит только ограниченный первый 6000-символьный window и оставляет
дальнейшие сцены on-demand до появления доказанной границы.

Политика доступности:

- каталог: prefetch разрешён только coalescer-ом и bootstrap-кампаниями;
- личная книга: только `POST /scenes/at` после действия пользователя;
- retry failed job — durable retry backend, никогда не новый клиентский prompt;
- deploy/restart worker не запускает backfill каталога автоматически.

## Bootstrap топ‑100

### Выбор границы первой главы

Для каждого активного издания с опубликованной v3-разметкой:

1. взять последнюю shadow publication, совпадающую с `markup.input_hash`;
2. взять `normalized_text_object_key`, `normalized_text_hash`, `text_length` и
   `content_navigation`/`sections` из того же analysis run;
3. удалить служебные сегменты (`Заглавие`, `Содержание`, `Информация`, credits,
   `MediaWiki:*`, предисловие и т. п.) и структурные `Часть/Том/Part/Book`;
4. выбрать первый оставшийся повествовательный сегмент. Для пьесы это первое
   `Действие`, для пролога — `Пролог`, для нумерованных глав — `I`/`Глава I`;
5. если остаётся только весь документ или граница не доказана, использовать
   консервативный `[0, min(6000, textLength))` и пометить `bounded-fallback`;
6. сгенерировать все `text-interval-v1` slots, пересекающие выбранный диапазон
   (`excerpt_start < chapter_end && excerpt_end > chapter_start`).

Это не создаёт сцен следующей главы: slot на границе включается только потому,
что его canonical interval пересекает первую главу.

### Безопасный запуск

Bootstrap выполняется SQL-операцией, повторяемой без дублей:

- существующие slots/jobs не вставляются повторно;
- `queued` target jobs получают campaign priority;
- `failed` target jobs сбрасываются в `queued` с нулём попыток;
- старый queued backlog временно удерживается (`available_at`), чтобы worker не
  мог взять scene за пределами bootstrap-диапазона;
- запускается только `book-markup-worker` с
  `BOOK_MARKUP_WORKER_JOB_TYPES=scene_image` и точным списком
  `BOOK_MARKUP_WORKER_EDITION_IDS` 99 доступных книг;
- после завершения удержанный backlog возвращается в исходный поток; jobs за
  пределами первой главы не считаются результатом кампании.

Ранг №1 не включается в текущую транзакцию: после публикации его v3-разметки
нужно повторить тот же идемпотентный bootstrap только для этого edition.

## Наблюдаемость и приёмка

Метрики и логи должны различать `catalog`/`private`, campaign id, edition,
markup hash, scene key и slot index:

- `scene_ready`, `scene_failed`, latency и provider error;
- число queued/running/ready/failed target jobs;
- `frontier_advanced`, `prefetch_enqueued`, `prefetch_skipped_duplicate`;
- отсутствие jobs при `manifest` и обычном progress событии;
- скачивание signed URL и успешное сохранение локального файла.

Перед выпуском мобильной части обязательны тесты на повторный tap, два CFI в
одном slot, смену позиции во время polling, background/resume, истёкший signed
URL, новую `markupIdentity`, offline outbox и private-книгу. Для backend —
тесты max-фронтира, 25%-checkpoint, задержки, идемпотентности и разделения
catalog/private.
