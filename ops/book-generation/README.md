# Кампания генерации 500 книг

Актуальная кампания: `campaign-500-v1.json`.

Она фиксирует четыре независимых набора:

- 500 неопубликованных книг для разметки: 232 RU и 268 EN;
- 50 уникальных популярных книг для портретов: 25 RU и 25 EN;
- 8 популярных, но слишком больших книг, отложенных из основной кампании;
- 13 книг без готовой обложки на момент снимка каталога.

## Как построен приоритет

Индекс `services/narra-gateway/data/catalog-book-popularity.json` рассчитан для
1500 канонических книг каталога. Основной сигнал — просмотры страницы
произведения в Wikimedia за 60 дней (2026-06-26 — 2026-08-24), дополнительный
сигнал — число sitelinks Wikidata и просмотры страницы автора. Сопоставление
страницы произведения проверяется по типу сущности и автору; все исходные
сигналы и URL сохранены рядом с итоговым индексом для аудита.

`popularityIndex` — целое число от 1 000 000 до 0, рассчитанное отдельно внутри
RU и EN. Это порядок выдачи/генерации, а не оценка литературного качества.
Дубли изданий одного произведения не занимают дополнительные места в
кампании или top-50.

Порог большой книги — 1 500 000 символов нормализованного текста. В отдельный
список попали:

- `Братья Карамазовы`, `Цусима`, `Бесы`;
- `Les Misérables`, `David Copperfield`, `Middlemarch`, `Armadale`,
  `The Mysteries of Udolpho`.

## Воспроизведение

Для пересборки из уже проверенного локального Wikimedia cache:

```bash
python3 scripts/build-catalog-book-popularity.py \
  --book-data services/narra-gateway/data/catalog-book-genres.json \
  --catalog-export /private/tmp/narra-catalog-export.csv \
  --cache /private/tmp/narra-wikimedia-popularity-cache.json \
  --output services/narra-gateway/data/catalog-book-popularity.json \
  --campaign-output ops/book-generation/campaign-500-v1.json \
  --workers 1 \
  --offline
```

Для подготовки безопасного SQL приоритетов:

```bash
python3 scripts/render-book-generation-campaign-sql.py \
  ops/book-generation/campaign-500-v1.json \
  --output /private/tmp/apply-book-generation-campaign-500-v1.sql
```

SQL проверяет привязку всех 500 книг к текущим `book-analysis-v49` /
`book-scan-v17`, меняет только queued jobs выбранных книг, никогда не понижает
приоритет и отдельно поднимает queued `character_portrait` для top-50.
Его нужно применять повторно после появления новых стадий и portrait jobs.

## Состояние fun1 на 2026-08-25

Приоритеты применены:

- 58 444 scan jobs;
- 6 952 synthesize jobs;
- 472 уже созданных portrait jobs из top-50.

Пробные реальные вызовы LiteLLM/OpenRouter для текста и изображений получили
`HTTP 402` (`GENERATOR_HTTP_402`). Поэтому затратные workers остановлены;
активными оставлены только Gateway, resolve, validate и publish. GigaChat не
использовать ни как primary, ни как fallback для этой кампании.

После пробного запуска разметки сохранили возможность продолжения: 11 scan jobs
и 61 synthesize jobs остались queued с одной-двумя попытками. Все 13 отсутствующих
обложек исчерпали три попытки и находятся в failed.

## Продолжение после восстановления баланса

1. Проверить один реальный text request через `litellm` и модель
   `openrouter/openai/gpt-5.6-luna`. Не переключать на GigaChat.
2. Повторно применить обычный SQL приоритетов.
3. Начать с одного scan и одного synthesize worker; после успешной проверки
   поднять максимум до 8 scan / 4 synthesize при общем LLM concurrency 16.
4. Проверить отдельно один image request. Только после его успеха подготовить
   точечный requeue 13 обложек:

```bash
python3 scripts/render-book-generation-campaign-sql.py \
  ops/book-generation/campaign-500-v1.json \
  --retry-failed-covers \
  --output /private/tmp/retry-missing-covers-after-balance.sql
```

5. Применить recovery SQL и запустить media worker. Recovery затрагивает только
   baseline-список, только `catalog-cover-v3`, только failed jobs с
   `GENERATOR_HTTP_402` и только если готовой обложки всё ещё нет.
6. По мере публикации разметок top-50 повторно применять обычный SQL: новые
   portrait jobs получат приоритеты 1000–951. Готовность считать по всем
   персонажам каждой из 50 книг, а не по числу уже созданных jobs.

Не запускать recovery SQL до устранения `HTTP 402`: иначе те же 13 jobs снова
израсходуют попытки без результата.
