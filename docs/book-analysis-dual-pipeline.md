# Переключаемые pipeline разметки книг

## Результат

Новые analysis runs выбирают одну из двух независимых стратегий:

- `narra` — существующий `book-analysis-v49` со scan `book-scan-v17`,
  `character-identity-v22` и текущим `character-profile-v14` synthesis;
- `external` — `external-autiobook-v1.d532bdd0`, изолированный HTTP-адаптер
  над `khimaros/autiobook` commit
  `d532bdd0a15f2948fd0c99f5e11b92677cb5c3eb`.

Без selector всегда выбирается `narra`. Локальный default новых runs можно
изменить через `BOOK_ANALYSIS_PIPELINE=narra|external`. Значение сохраняется в
`book_analysis_runs` и больше не перечитывается для retry, worker recovery или
restart lineage.

```bash
npm run book-analysis -- start \
  --book-edition-id <uuid> \
  --pipeline external
```

`restart` с `--pipeline` выбирает соответствующую lineage. `restart` без
selector наследует pipeline последнего run этой книги, даже если env default
изменился.

Интеграция не меняет resolver/profile prompts и не объявляет незавершённые
эксперименты `character-profile-v13` новой стабильной Personality-базой.

## Durable boundary

Run сохраняет:

- `pipeline_id`;
- `pipeline_implementation_version`;
- orchestration/extractor versions;
- `input_hash` и `normalized_text_hash`;
- `normalization_version`;
- `output_schema_version`.

Каждый job хранит ту же пару `pipeline_id + implementation_version` и связан с
run составным foreign key. Триггеры запрещают изменение pipeline у run/job.
Поэтому стадии одного run нельзя выдать воркеру другой стратегии.

Idempotency/cache identity включает pipeline id, implementation version,
source content hash, orchestration/extractor versions,
`normalized-text-v1`, schema v3 и `book-markup-v3`. Два pipeline не имеют общего
cache namespace.

## Общий контракт

Обе стратегии завершаются одинаковыми стадиями:

```text
prepare → scan → resolve → synthesize → validate → publish
```

Strategy registry в `book-analysis-pipeline.mjs` определяет scan topology,
identity policy, profile synthesis и quality policy. Repository отвечает только
за durable state machine и получает эти решения из registry.

Обе стратегии формируют `schemaVersion: 3` / `book-markup-v3` и проходят один
`validateBookMarkupV3`. Pipeline metadata не добавляется внутрь публичного
markup DTO: она хранится рядом с ним во внутреннем publication `provenance`.

## External evidence boundary

External scan — одна book-level задача. Adapter получает полный canonical
normalized text, последовательно выполняет upstream cast/script и возвращает
только:

- `character_dialogue`;
- `character_alias`.

Каждая observation содержит дословную quote и UTF-16 offsets. Gateway независимо
проверяет `source.slice(startOffset, endOffset) === quote`. Переписанный текст,
неподтверждённые aliases и synthetic speakers отбрасываются. Персонаж становится
confirmed только при наличии хотя бы одной точной dialogue observation.

External strategy не вызывает Narra identity/profile LLM. Профиль содержит до
трёх exact speech examples; role, age, gender, description, traits, appearance,
speech style и creative поля остаются пустыми.

Автоматического fallback на `narra` нет. Ошибка adapter/upstream остаётся ошибкой
external run.

## Локальное исследование

Production compose не менялся. Изолированные сервисы подключаются только в
локальном профиле:

```bash
docker compose \
  --env-file book-analysis-local.env \
  --file compose.book-analysis-local.yml \
  --project-name narra-dual-pipeline-research \
  --profile book-analysis-external up --build
```

Adapter не открывает host port, запускается не от root, имеет read-only root
filesystem и отдельный `/work`. Его content-addressed cache включает external
pipeline/version/source/config identity. Текст книги и credentials не пишутся в
логи.

Для side-by-side исследования создаются два run с одинаковым `inputHash` и
разными pipeline. `evaluation/compare-book-analysis-pipelines.mjs` проверяет
независимые run/publication provenance и применяет один frozen identity scorer к
обоим результатам.

## Известные ограничения external

- upstream проверен на frozen Russian drama corpus, но это не доказательство
  качества на прозе с неявной атрибуцией реплик;
- profile facts без точных source evidence намеренно не публикуются;
- одна книга обрабатывается одним external scan job; масштабирование идёт по
  независимым книгам;
- итог зависит от настроенной OpenAI-compatible модели upstream;
- upstream GPL-3.0 требует соблюдения лицензии при распространении adapter image.
