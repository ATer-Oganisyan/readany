# Локальный gateway: readiness, не приёмка живого AI

## Изменение и проверка listener

Добавлена необязательная переменная `GATEWAY_HOST`: `127.0.0.1` ограничивает
listener loopback; пустое/отсутствующее значение сохраняет прежний wildcard
deployment. `index.mjs` использует `gateway-listener.mjs`.

Поведенческий тест настоящего HTTP listener (`test/gateway-listener.test.mjs`):
2 RED / 1 PASS до реализации → **3 PASS**. Проверены socket address, HTTP GET,
пробелы вокруг адреса и прежнее поведение без настройки. Это не текстовая
проверка исходника. Команда:

```sh
node --test services/narra-gateway/test/gateway-listener.test.mjs
```

## Оставленный локальный процесс

- Gateway PID **53832**, orchestration exec session **2382**.
- `lsof`: **127.0.0.1:18787**, только IPv4 loopback.
- Node 24.20.0; build marker `local-core-loop-readiness`.
- Data dir: `/var/folders/s5/c9slzsgj5_dbzvp02cv3569r0000gn/T/narra-local-gateway-tlAMW9`.
- Использован существующий изолированный PostgreSQL 55438, но создана **новая**
  БД `narra_local_gateway_20260905`, чтобы автоматические migrations/cleanup
  gateway не затрагивали прежние audit-таблицы.
- Использован существующий изолированный MinIO 59000, но создан **новый**
  bucket `narra-local-gateway-20260905`.
- Новые dev signing/generator secrets созданы в памяти процесса; provider keys
  не задавались. Секреты и installation token не выводились и не коммитились.
  Этот одноразовый запуск не является конфигурацией для стабильных перезапусков.
- Cover/scene runners отключены, analysis media backfill отключён, отдельные
  analysis/search/scene workers не запускались. Платных model calls: **0**.
- Для завершения — SIGTERM конкретному gateway PID; это сохраняет созданные
  собственные артефакты. Не останавливать общие PG/MinIO.

## Проверенный настоящий HTTP/DB/S3 маршрут

`GET /health` → 200: `book_markup=true`, `book_storage=true`,
`internal_generation=true`; `gigachat/salutespeech/kandinsky/cover/video=false`.
Internal-generation=true означает наличие локальной инфраструктуры и токена,
**не готовность upstream AI**.

`GET /ready` → **503**, ожидаемо: `llm/speech/image=false`, но
`storage=true`, `book_backend=true`. Полная readiness намеренно не подменяется
одним успешным `/health`.

Дополнительные регрессии: **50 PASS, 0 skipped** — gateway-listener,
readiness, deploy-cli (изолированные подмены CLI, без remote deployment),
book-object-storage, book-upload-admission. `node --check index.mjs` и
`git diff --check` проходят.

Создана отдельная локальная installation, не идентичность приложения TEST:

1. `POST /v2/installations/register` → 201.
2. `GET /v2/books/catalog` → 200.
3. `POST /v2/books/resolve` → 200, local_registration_required.
4. `POST /v2/books/local` → 201, private.
5. `PUT /v2/books/:id/source` → 202, собственный FB2 размером 353 bytes.
6. `GET /v2/books/:id/manifest` → 202, processing.

Собственная fixture edition: `43c95151-9dfb-466f-b37d-a59a9b3ce524`.
Processing ожидаем: workers/AI не включались. Библиотека устройства, Metro,
профиль окружения приложения, TEST и production не изменялись.

## Что остаётся

TEST `/health` по-прежнему возвращал HTML nginx 502; источник upstream-сбоя
не установлен без инфраструктурных логов. Локальный запуск обходит этот блокер
только для HTTP/DB/storage, не заменяет проверки живого анализа, сцен, чата и речи.
Для следующего этапа нужны явная server-only provider-конфигурация, ограниченный
запуск workers и отдельный согласованный клиентский LOCAL профиль. Speech в
текущем gateway использует SaluteSpeech; подстановка одного текстового ключа не
подключает автоматически озвучку и изображения.
