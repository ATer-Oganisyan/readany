---
type: component
status: current
scope: book covers, character media and scene generation
last-reviewed: 2026-09-17
---

# Генерация медиа

## Модель владения

В коде есть два семейства media workflow:

1. installation-scoped API для собственной книги: durable cover/scene jobs с
   base64 result и явным `ack`, плюс legacy synchronous `/v2/media/images`;
2. canonical book media в PostgreSQL/MinIO: catalog covers, versioned character
   bundles и book-bound inline scenes со signed download URL.

Они используют общие image providers, budgets и часть prompt policy, но это не
один контракт. `book_edition_id`, installation `request_id` и локальный
`book.id` — разные identity domains.

## Что запускается автоматически

| Артефакт | Собственная книга | Книга каталога |
| --- | --- | --- |
| Обложка | после нового import, только если нет embedded, bundled catalog match или уже сохранённой cover | operator может загрузить cover независимо; при включённом media generation publish/startup backfill обеспечивает недостающие catalog covers |
| Портрет/голос/idle animation canonical character | по media frontier: текущая позиция + 10% длины; только characters, чей warmup достигнут | вся длина — frontier; publish legacy markup path и startup backfill могут поставить всех characters |
| Локальный legacy-портрет | при открытии карточки уже открытого non-backend character без portrait, максимум две попытки | не запускается для `backendManaged` character |
| Inline scene | никогда автоматически | никогда автоматически |
| Scene backfill | только явный operator action, если применимо | только явный operator action; startup прямо сообщает `on-demand only` |

Warmup разрешает заранее вычислить media, но asset/character остаётся скрытым
до `firstAppearance`. Expo скачивает canonical assets максимум двумя потоками:
сначала portraits открытых героев, затем ровно один будущий portrait для
прогрева, затем остальные assets открытых. Перед commit проверяются hash/size;
future portrait не раскрывает карточку персонажа.

## Обложки

### Контекст собственной книги

После импорта клиент повторно проверяет source форматов EPUB/FB2/MOBI/AZW/AZW3,
чтобы временная ошибка extraction не считалась отсутствием embedded cover.
Приоритет:

1. встроенная cover из source;
2. bundled catalog cover при точном известном сопоставлении;
3. durable generated cover.

Для генерации клиент передаёт только структурированные факты:

```json
{
  "request_id": "<uuid-v4>",
  "book": {
    "title": "до 500 символов",
    "author": "до 500",
    "description": "до 2000",
    "excerpt": "до 2000",
    "subjects": ["до 32 значений по 120"]
  }
}
```

Gateway, а не mobile, строит `book-cover-prompt-v3`: theme берётся из
description, иначе excerpt (до 800 символов), genre/art direction определяется
из subjects/title/context, background color детерминирован по title+author.
Таким образом server может обновить policy без выпуска клиента. Legacy вариант
тела `{request_id,prompt}` допускается для совместимости, но ровно одно из
`prompt` и `book` обязательно.

### Durable cover API

```http
POST /v2/media/cover/jobs
GET  /v2/media/cover/jobs/{jobId}
POST /v2/media/cover/jobs/{jobId}/ack
Authorization: Bearer <installation_token>
```

POST идемпотентен по installation + `request_id`. Pending POST возвращает
`202`, terminal POST/GET — `200`:

```json
{
  "job_id": "<uuid>",
  "status": "queued|running|retry_wait|completed|failed",
  "poll_after_ms": 3000,
  "attempt_count": 1,
  "expires_at": 1780000000000,
  "image": "<base64 only when completed>",
  "mime_type": "image/jpeg",
  "model": "<server-selected model>",
  "code": "<only on failure>",
  "error": "<only on failure>"
}
```

Client сохраняет request/job id в локальный repository, переживает relaunch,
валидирует image, атомарно записывает файл и обновляет DB. Только после
повторной проверки disk+DB вызывает `ack`; `204` и `404` трактуются как
успешное подтверждение, чтобы потерянный ACK не породил повторную генерацию.
Серверный runner выполняет provider fallback и хранит временный result до ACK/TTL.

### Каталожная обложка

Catalog ingest имеет отдельные begin/upload/complete операции для cover, то
есть редакционная обложка не обязана генерироваться. Если её нет и media
generation включена, catalog publication/worker или startup backfill ставит
`catalog_cover` job. Source cover извлекается на сервере, когда доступна;
иначе prompt строится из canonical identity и representative book context.
Expo получает готовую cover через `/v2/books/:edition/cover/download` и не
запускает private cover job для `sourceKind=catalog`.

## Портреты и character bundle

### Canonical backend bundle

`character-bundle-v3` логически атомарен, но вычисляется тремя независимыми
durable jobs:

- `primary_portrait` / `character_portrait`;
- `greeting_audio` / `character_audio`;
- `idle_animation` / `character_animation`.

Media revision и source markup hash входят в idempotency key. Готовым bundle
считается только набор всех обязательных типов; смена source markup создаёт
новую revision, не подменяя старый asset случайным результатом позднего worker.

Серверный portrait prompt получает:

- ровно одного человека: `fullName`;
- title/author как контекст мира и эпохи;
- appearance по приоритету `creative.appearancePrompt`, `appearancePrompt`,
  список appearance/passport, затем age/role/name fallback;
- естественное выражение, вертикальный портрет до талии, светлый фон;
- classic book-illustration style и запрет текста/логотипов;
- hard budget 1 600 символов.

Genre и expression не входят в текущую границу canonical bundle, поэтому
server prompt использует classic default. Это отличается от более богатого
локального prompt и важно при оценке консистентности. Для Буратино есть явное
правило деревянной театральной марионетки.

### Legacy/local portrait

У non-backend character открытие разблокированной карточки без доступного файла
автоматически вызывает `ensureCharacterPortrait` (не более двух попыток за
сессию). Явная команда Regenerate всегда создаёт новую картинку через
`POST /v2/media/images` с `768x1024`, `engine=openrouter` и помечает локальный
URI как override. Client prompt включает book description/genre, appearance
passport и compliance, поэтому он не эквивалентен canonical server bundle.
Для `backendManaged` character локальная автогенерация запрещена: клиент ждёт
canonical asset и не расходует второй job на тот же portrait.

## Сцены: два API-контура (и один удалённый)

### A. Selected-text screen — удалён

До 2026-09-17 существовал экран `NarraSceneScreen`: пользователь выделял текст,
клиент сам собирал prompt и синхронно звал `POST /v2/media/images`
(`1024x1024`, `engine=openrouter`, fallback на `kandinsky`), а озвучку и
«оживление» сцены в видео делал напрямую в OpenRouter ключом из бандла. Экран
был недостижим из навигации и удалён вместе с ключом `EXPO_PUBLIC_OPENROUTER_API_KEY`
и переключателем `EXPO_PUBLIC_NARRA_TTS_PROVIDER`: у приложения остался один
путь к AI — gateway. Старые сцены с `sourceKey = page:<cfi>` без anchor
по-прежнему читаются из локального состояния, но в текст не возвращаются
(`scene-inserts.ts`), и новые не создаются.

### B. Structured installation scene jobs (durable, пока без Expo call site)

Контракт реализован и сервер владеет prompt/provider/retry/result:

```http
POST /v2/media/scene/jobs
GET  /v2/media/scene/jobs/{jobId}
POST /v2/media/scene/jobs/{jobId}/ack
```

```json
{
  "request_id": "<uuid-v4>",
  "book_title": "до 500, обязательно",
  "book_author": "до 500",
  "book_description": "до 4000",
  "book_subjects": ["до 32 по 200"],
  "genre_id": "до 80",
  "chapter": "до 500",
  "excerpt": "до 4000, обязательно",
  "characters": [
    {
      "name": "до 160, обязательно",
      "full_name": "до 240",
      "role": "до 400",
      "gender": "до 32",
      "appearance": "до 1500"
    }
  ],
  "previous_excerpts": ["до 2 по 1200"]
}
```

`characters` и `previous_excerpts` передаются как массивы, даже когда они
пусты. Characters ограничены 16; server включает в prompt только упомянутых в excerpt,
выбирает genre art direction и ужимает итог до provider budget 950. Lifecycle,
response shape, persistent result и ACK совпадают с cover jobs, но расходуется
scene/image budget и default MIME — PNG. На дату ревью production Expo code не
вызывает `/v2/media/scene/jobs`; это доступный, но не активный mobile workflow.

### C. Canonical inline reader scene (book-bound, активный)

WebView показывает slot «Сгенерировать сцену». Только tap вызывает:

```http
POST /v2/books/{bookEditionId}/scenes/at
Content-Type: application/json

{"progress_fraction": 0.42, "retry_failed": true}
```

Вместо fraction можно передать `reader_text_offset`; ровно одно координатное
поле обязательно. Gateway разрешает позицию в latest canonical publication и
строит `reader-card-v1` scene identity по точному anchor offset. Context — до
500 символов immutable normalized text, заканчивающихся на позиции; персонажи
берутся из canonical markup, если уже появились в этом excerpt. Client не
может подменить source excerpt, genre или character passport.

Ответ `200` для ready, `202` для queued/running/markup processing, `409` для
terminal markup failure:

```json
{
  "status": "queued|running|ready|failed",
  "code": null,
  "error_code": null,
  "retryable": false,
  "analysis": null,
  "scene_key": "reader-card-v1:39000",
  "slot_index": 123000,
  "anchor_text_offset": 39000,
  "image_url": "https://signed-url.example/...",
  "mime_type": "image/png",
  "expires_at": 1780000000000,
  "poll_after_ms": 2000
}
```

Client повторяет тот же POST/snapshot до ready (общий deadline пять минут),
скачивает signed URL, валидирует и сохраняет локальный asset, затем восстанавливает
его при повторном mount slot. ACK нет: result принадлежит canonical book job в
PostgreSQL/MinIO. Legacy `text-interval-v1` с шагом 6 000 остаётся policy для
operator backfill, но reader tap использует точную `reader-card-v1` позицию.

## Сходства и различия

| Свойство | Cover jobs | Structured scene jobs | Inline `/scenes/at` | Legacy `/media/images` |
| --- | --- | --- | --- | --- |
| Инициатор | auto после private import | потенциально user | явный tap slot | явный portrait regenerate |
| Prompt owner | gateway из book facts | gateway из structured facts | gateway из canonical source+markup | client |
| Identity | installation + UUID v4 | installation + UUID v4 | edition + markup hash + exact anchor | отсутствует |
| Durable polling | да | да | да, повтором snapshot POST | нет |
| Результат | base64 | base64 | signed URL | base64 |
| ACK | после disk+DB verify | после сохранения | нет | нет |
| Expo используется | да | нет | да | только portrait regenerate |
| Автоматический backfill | private import trigger; catalog отдельно | нет | отключён | нет |

## Инварианты

- Private job одного installation недоступен другому installation.
- ACK выполняется только после доказанного локального сохранения.
- Canonical media всегда привязано к edition и source markup revision.
- Future character media разрешено прогревать, но запрещено раскрывать.
- Открытие книги, manifest и progress не создают inline scene jobs.
- Prompt context имеет явные limits; произвольный текст пользователя не
  пересекает server-owned canonical scene boundary.
