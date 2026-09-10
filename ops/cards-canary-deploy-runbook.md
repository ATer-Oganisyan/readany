# Конвейер карточек: раскатка на канареечные книги и наблюдение

Записано 2026-09-10 по итогам раскатки на три книги. Хост `fun1`
(`andrew@10.10.5.34` через `i167`), проект `narra-production-v2`, каталог
`/opt/narra-production-v2`.

## Дашборд

`https://…/operator/status` — воркеры и прогресс книг. Доступ только через
SSH-туннель: gateway слушает `127.0.0.1:8788` и наружу не смотрит.

```bash
ssh -N -L 8788:127.0.0.1:8788 fun1
# затем открыть http://127.0.0.1:8788/operator/status
```

Логин и пароль — `BOOK_OPERATOR_USERNAME` / `BOOK_OPERATOR_PASSWORD` из
`/opt/narra-production-v2/compose.env`.

Страница показывает три вещи и ничего не меняет:

- **Воркеры** — по типам: сколько живо из поднятых, сборка, состояние. Живым
  считается отметившийся меньше минуты назад. Разные сборки у живых воркеров
  выносятся в подзаголовок: это первый признак недокатанного деплоя.
- **Сейчас в работе** — задания, держащие аренду: книга, стадия или тип,
  сколько держат. Аренда дольше 90 секунд подсвечивается.
- **Книги** — последний прогон каждой книги: конвейер, стадия, счётчики
  стадийных заданий, заданий прогона и медиа. Для карточек дополнительно —
  подтверждённый состав, опубликованные карточки и последнее окно.

Воркеры и занятые задания берутся из разных таблиц и не связаны между собой:
`worker_heartbeats.worker_id` — имя контейнера, а `locked_by` задания —
идентификатор процесса. Это два ответа на два разных вопроса: «кто поднят» и
«что сейчас в работе».

## Как здесь собирают образ

GitHub Actions не запускается: *«The job was not started because recent account
payments have failed or your spending limit needs to be increased»*. Пока
биллинг не починен, образ собирается прямо на сервере, а деплой идёт штатными
файлами с `--pull never`:

```bash
SHA=$(git rev-parse HEAD)
git archive --format=tar "HEAD:services/narra-gateway" | gzip -9 > "/tmp/narra-$SHA.tar.gz"
ssh fun1 "mkdir -p ~/narra-image-build/$SHA"
scp "/tmp/narra-$SHA.tar.gz" "fun1:narra-image-build/$SHA/src.tar.gz"
ssh fun1 "cd ~/narra-image-build/$SHA && tar xzf src.tar.gz \
  && sudo docker build --build-arg GATEWAY_BUILD_VERSION=$SHA -t narra-gateway:$SHA . \
  && rm -rf ~/narra-image-build"
```

`deploy-remote.sh` возит на сервер только `deploy.sh`, `migrate.sh` и
`compose.i167.yml`; исходников и секретов на сервере не остаётся.
ProxyJump он не умеет, поэтому `fun1` должен быть хостом в `~/.ssh/config`.

## Деплой

```bash
cd services/narra-gateway
SHA=<40-символьный git sha>
COMMON="--environment prod --host fun1 \
  --remote-root /opt/narra-production-v2 \
  --bundle-version $SHA \
  --image narra-gateway:$SHA \
  --env-file /opt/narra-production-v2/compose.env \
  --project narra-production-v2 --pull never"

ssh fun1 "sudo sed -i 's|^NARRA_GATEWAY_IMAGE=.*|NARRA_GATEWAY_IMAGE=narra-gateway:$SHA|' \
  /opt/narra-production-v2/compose.env"

./deploy-remote.sh $COMMON --operation migrate-check
./deploy-remote.sh $COMMON --operation migrate-apply --confirm
./deploy-remote.sh $COMMON --operation deploy --mode selected --component runtime
```

`--component runtime` — gateway и все воркеры, без PostgreSQL и MinIO.
`--remove-orphans` снимает контейнеры сервисов, которых в compose уже нет.

`NARRA_GATEWAY_IMAGE` правится именно в `compose.env`. Передать образ
одноразовому контейнеру через `docker compose run -e` **нельзя**: `-e` задаёт
переменную внутри контейнера, а compose берёт образ из `--env-file` и запустит
старый. Так уже случилось: неадресный повтор заданий выгреб сотню чужих
провалов.

Резервная копия базы перед миграциями:

```bash
ssh fun1 'sudo docker exec narra-production-v2-postgres-1 sh -c \
  '"'"'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'"'"' \
  | sudo tee /opt/narra-production-v2/backups/pre-<дата>.dump > /dev/null'
```

## Включение книги в канарейку

Список изданий в `compose.env` — он решает конвейер для прогонов, которые
gateway создаёт сам:

```
BOOK_ANALYSIS_CARDS_EDITIONS=<uuid>,<uuid>,<uuid>
```

Опечатка в идентификаторе роняет gateway на старте — это намеренно.

Запуск конкретной книги (`--pipeline cards` задан явно, чтобы одноразовый
контейнер не зависел от того, дошёл ли до него список):

```bash
ssh fun1 "sudo docker compose --project-name narra-production-v2 \
  --env-file /opt/narra-production-v2/compose.env \
  --file /opt/narra-production-v2/releases/\$SHA/compose.i167.yml \
  --profile operations run --rm --no-deps migrate \
  node analysis/book-analysis-operator.mjs restart \
    --book-edition-id <uuid> --pipeline cards"
```

Назначение поимённо сильнее наследования конвейера от предыдущего прогона:
книга, уже разобранная старым конвейером, перейдёт на карточки.

## Повтор провалившихся заданий

Только адресно — на установке 28 тысяч старых провалов, и повтор без фильтров
возьмёт чужие:

```bash
node books/retry-failed-book-generation.mjs \
  --job-type roster_confirm --edition <uuid> --limit 10
```

## Что уже наступало

- **Стадии.** Триггер из миграции 005 требовал шага ровно на одну стадию, а
  карточки идут `prepare → synthesize`. Лечится миграцией 033; симптом —
  `prepare.failed` с `error_code="UNKNOWN"` до исчерпания попыток.
- **Хранилище воркеру карточек.** Без него `ROSTER_STORAGE_UNAVAILABLE` и
  `CARD_STORAGE_UNAVAILABLE`: и состав, и карточка читают нормализованный текст
  ради цитаты по смещению. В логе старта воркера видно `object_storage=true`.
- **Аллоўлист без подключения.** `BOOK_ANALYSIS_CARDS_EDITIONS` разбирался, но
  до создания прогона не доходил, и список не давал карточек никому.
- **Модель structured-task.** `deepseek/deepseek-v4-flash` отвечает по 100–124 с
  и иногда возвращает текст вместо JSON — gateway пишет
  `error_detail="LLM did not return a JSON object"`. Тем же затронут обычный
  конвейер: scan-задания копятся с `TIMEOUT`. Проверять на дашборде по
  «Сейчас в работе»: длинные аренды у `character_card` и `scan` — это оно.

## Откат

```bash
./deploy-remote.sh $COMMON --operation deploy --mode selected --component runtime \
  --image readany/narra-gateway:d283d7d2 --pull always
```

и вернуть `compose.env` из копии рядом с ним. Миграции 027–033 только добавляют
таблицы, ограничения и одно послабление триггера; прежний образ с ними работает.
