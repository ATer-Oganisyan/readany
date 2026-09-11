# Раскатка конвейера карточек на три канареечные книги

Дата подготовки: 2026-09-10. Хост: `andrew@10.10.5.34` (fun1, через `i167`).
Проект: `narra-production-v2`, каталог `/opt/narra-production-v2`.

## Что уже сделано

- Образ `narra-gateway:1d9c37026860ebe0a859ba597ec5cd3b532e113f` **собран на fun1**
  (amd64, 426 МБ) и проверен: резолвер конвейера на месте, воркер берёт
  `character_card,roster_confirm`, миграции 027–032 в образе (всего 35).
- `/opt/narra-production-v2/compose.env` скопирован в
  `compose.env.bak-20260910-180936`.
- Исходники сборки с сервера удалены; в образе они уже есть.

## Почему образа нет в registry

GitHub Actions не запускается: *«The job was not started because recent account
payments have failed or your spending limit needs to be increased»*. Последние
шесть прогонов `narra-gateway.yml` падают за 2 секунды без раннера, в том числе
на merge-коммите `2751c137`. Пока биллинг не починен, CI не публикует образ ни в
`ghcr.io/mishanaer/narra-gateway`, ни куда-либо ещё, а локальных учётных данных
для `docker push` в Docker Hub (`readany/…`, `arsenteroganisyan/…`) нет.

Поэтому образ собран на самом сервере и разворачивается с `--pull never`.
Файлы деплоя используются штатные: `deploy-remote.sh` кладёт на сервер только
`deploy.sh`, `migrate.sh` и `compose.i167.yml`.

## Шаги

Все команды — с рабочей машины, из `services/narra-gateway`.

```bash
SHA=1d9c37026860ebe0a859ba597ec5cd3b532e113f
COMMON="--environment prod --host andrew@10.10.5.34 \
  --remote-root /opt/narra-production-v2 \
  --identity-file $HOME/.ssh/i196_andrew \
  --bundle-version $SHA \
  --image narra-gateway:$SHA \
  --env-file /opt/narra-production-v2/compose.env \
  --project narra-production-v2 --pull never"
```

### 1. Дописать настройки в `/opt/narra-production-v2/compose.env`

На сервере, под `sudo`:

```
NARRA_GATEWAY_IMAGE=narra-gateway:1d9c37026860ebe0a859ba597ec5cd3b532e113f
BOOK_ANALYSIS_CARDS_EDITIONS=15b99e46-cfe1-467b-99eb-927cd43e83c6,57546569-e108-4213-83cb-fc1450fb55e8,e0f9d716-6e12-4e7c-b301-23592976d464
BOOK_ANALYSIS_WORKER_REPLICAS=6
BOOK_CARD_WORKER_REPLICAS=2
```

`BOOK_ANALYSIS_SCAN_REPLICAS` и `BOOK_ANALYSIS_SYNTHESIZE_REPLICAS` больше не
читаются: шесть прежних раннеров заменены одним `book-analysis-worker`.
Опечатка в идентификаторе издания уронит gateway на старте — это намеренно.

### 2. Резервная копия базы

```bash
ssh -J i167 andrew@10.10.5.34 \
  'sudo -n docker exec narra-production-v2-postgres-1 \
     pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
   > /opt/narra-production-v2/backups/pre-cards-$(date +%Y%m%d-%H%M).dump'
```

Постраничные бэкапы трёх книг уже лежат в
`~/narra-cards-canary/backups/pre-cards-20260910-1741/`.

### 3. Миграции 027–032

```bash
./deploy-remote.sh $COMMON --operation migrate-check
./deploy-remote.sh $COMMON --operation migrate-apply --confirm
```

`migrate-check` обязателен: `runBookMarkupMigrations` сверяет контрольные суммы
уже применённых миграций до выполнения SQL.

### 4. Деплой

```bash
./deploy-remote.sh $COMMON --operation deploy --mode selected --component runtime
```

`--component runtime` — gateway и все воркеры, без PostgreSQL и MinIO.
`--remove-orphans` снимет шесть прежних раннеров анализа
(`book-analysis-scan-1..6`, `prepare`, `resolve`, `synthesize`, `validate`,
`publish`) — они заменены на `book-analysis-worker`.

Проверка после деплоя:

```bash
ssh -J i167 andrew@10.10.5.34 \
  'sudo -n docker ps --filter label=com.docker.compose.project=narra-production-v2 \
     --format "{{.Names}}\t{{.Image}}\t{{.Status}}"'
```

Ожидается `book-card-worker-1..2` и `book-analysis-worker-1..6` на новом образе.

### 5. Запуск трёх книг

```bash
for EDITION in 15b99e46-cfe1-467b-99eb-927cd43e83c6 \
               57546569-e108-4213-83cb-fc1450fb55e8 \
               e0f9d716-6e12-4e7c-b301-23592976d464; do
  ssh -J i167 andrew@10.10.5.34 "sudo -n docker compose \
    --project-name narra-production-v2 \
    --env-file /opt/narra-production-v2/compose.env \
    --file /opt/narra-production-v2/releases/$SHA/compose.i167.yml \
    --profile operations run --rm --no-deps migrate \
    node analysis/book-analysis-operator.mjs restart \
      --book-edition-id $EDITION --pipeline cards"
done
```

`--pipeline cards` задан явно, чтобы одноразовый контейнер не зависел от того,
дошёл ли до него `BOOK_ANALYSIS_CARDS_EDITIONS`. Список всё равно нужен: он
решает конвейер для прогонов, которые создаёт gateway сам.

### 6. Наблюдение

По замерам на «Отцах и детях» (8 воркеров): первые персонажи — около 8 минут,
вся книга — около 14 минут. 92 % времени уходит на карточки, 8 % — на
подтверждение состава.

```sql
SELECT stage, status, count(*) FROM book_analysis_jobs
 WHERE run_id IN (SELECT id FROM book_analysis_runs WHERE pipeline_id = 'cards')
 GROUP BY 1, 2;

SELECT job_type, status, count(*) FROM generation_jobs
 WHERE job_type IN ('character_card', 'roster_confirm') GROUP BY 1, 2;
```

## Откат

```bash
./deploy-remote.sh $COMMON --operation deploy --mode selected --component runtime \
  --image readany/narra-gateway:d283d7d2 --pull always
```

и вернуть `compose.env` из `compose.env.bak-20260910-180936`. Миграции 027–032
только добавляют таблицы и ограничения; прежний образ с ними работает.

## Долг

- Починить биллинг GitHub Actions — без него нет ни CI, ни публикации образов.
- После merge PR #93 пересобрать образ с sha главной ветки: тег `1d9c3702`
  указывает на ветку, а не на main.
