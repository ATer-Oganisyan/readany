# Generation cost: фактические потребители и сохранение

2026-09-05. Read-only аудит runtime; внешние БД и модели не использовались. Этот документ не устанавливает требований биллинга и не утверждает, что стоимость неизвестных запросов равна нулю.

## Найденный потребитель

- `services/narra-gateway/generation-cost-ledger.mjs`: `generationCostReport()` читает `generation_cost_events`, соединяет записи с `book_editions`, возвращает details и суммы по книге/операции/провайдеру. Неизвестная цена явно учитывается как `unpriced_*`, отдельно от известного нуля.
- `services/narra-gateway/generation-cost-report.mjs`: CLI вызывает этот отчёт с явными `--book-edition-id`, опциональными `--from`/`--to`.
- `services/narra-gateway/package.json`: команда `report:generation-cost` запускает CLI.

По поиску ссылок на таблицу/функцию по репозиторию других runtime-потребителей, использующих эту таблицу для списания денег, пользовательского баланса, допуска по квоте или выставления счетов, не обнаружено. Это вывод о просмотренном коде, а не обещание об отсутствующих внешних системах. Квоты installation registry — другой механизм, его нельзя подменять данным отчётом.

## Фактический write path

`index.mjs` создаёт `generationCostLedger` только при наличии `DATABASE_URL`. `recordInternalGenerationCost` обёрнут в `createBestEffortGenerationCostRecorder` из `generation-cost-recorder.mjs`. Call sites записывают внутренние text/image generation attempts; публичный чат не следует автоматически считать полностью покрытым этим журналом. Speech также не входит в поддерживаемые ledger modalities: нормализатор допускает только `text` и `image`.

`createGenerationCostLedger(pool).record()`:

1. Валидирует контекст, request UUID и terminal attempts.
2. Для каждого terminal attempt последовательно вызывает `pool.query()` с `INSERT ... ON CONFLICT (attempt_id) DO UPDATE`.
3. Разрешает book ID по explicit `bookEditionId` или `analysisRunId`.
4. Сохраняет usage/цену при наличии, не заменяя неизвестные значения фиктивной стоимостью.

Миграция `migrations/018_generation_cost_ledger.sql` задаёт `attempt_id` как первичный ключ: повтор того же attempt не создаёт дополнительную строку. Книга имеет FK `ON DELETE CASCADE`, run — `ON DELETE SET NULL`. Следовательно, записи не являются независимым от удаления книг вечным журналом. Production call использует pool, а не одну оборачивающую все attempts транзакцию: ранний attempt может уже сохраниться, когда следующий query падает.

## Что реально означает REQUIRED

В `index.mjs` настройка `GENERATION_COST_LEDGER_REQUIRED` по умолчанию true; строка `false` отключает этот флаг. В самом ledger он контролирует только две ситуации:

- нет terminal provider attempt;
- INSERT не записал строку, потому что книга не разрешилась.

При required=true они бросают ошибку, при false логируют и возвращают/продолжают без записи. Ошибки SQL и валидации не получают отдельной durable обработки при false.

Но внешний `createBestEffortGenerationCostRecorder` ловит ошибки `ledger.record()` и возвращает `{recorded:0, skipped:'record_failed'}`. Отсутствующий ledger/context также приводит к skip. Поэтому **REQUIRED=true не означает end-to-end «сохранить обязательно»**. Это не commit barrier для продукта и не durable retry policy. Название настройки нельзя использовать как доказательство полноты cost data.

## Долговечность и ожидание

Имеющийся долговечный механизм — подтверждённый PostgreSQL UPSERT для конкретного attempt. До его подтверждения входные attempts/usage находятся в памяти вызывающего процесса. Отдельных cost outbox, spool, replay worker или durable pending receipt в этом пути не найдено.

`internal-generation-service.mjs` → `cached()` сохраняет `{version, requestHash, result}` в object storage. В текущем результате нет cost envelope с terminal attempts/usage и replay-инструкцией. Cache hit возвращает result; он не восстанавливает потерянную запись ledger.

Существующий `event-store.mjs` имеет файловый analytics outbox и доставку Traction, но cost recorder не пишет туда и replay в `generation_cost_events` отсутствует. Аналитический outbox нельзя назвать готовым cost WAL; кроме того, обычный appendFile не следует объявлять подтверждённым fsync-барьером.

`postgres-runtime.mjs` задаёт pool max и connection timeout, но не задаёт общий statement timeout для ledger queries. Ограничение установления соединения не ограничивает длительность уже выполняющегося SQL.

**Ограничить caller wait и одновременно гарантировать сохранение ещё нигде не подтверждённой записи на существующем пути нельзя.** Promise.race + продолжение query в памяти не создаёт долговечности, а timeout результата записи не равен отмене SQL. При crash такая deferred работа может потеряться. При освобождении provider permit и сохранении awaited cost write нужен отдельный bounded whole-lifecycle admission, иначе накопятся запросы/worker leases, ожидающие БД после окончания модели.

## Минимальный безопасный порядок работ

1. Сейчас: отдельно ограничить whole lifecycle fail-fast **до** запуска провайдера, освободить provider permit только после окончания потребления ответа, но оставить cost write awaited. Не добавлять detached promises, не пропускать cost call при переполнении и не запускать провайдера для уже отклонённой admission работы. Это защищает ресурсы; оно не устраняет ожидание у уже принятого запроса и не исправляет старую best-effort потерю при SQL error.
2. Для настоящего сокращения ожидания с сохранением данных требуется новый durable receipt/outbox: хранить attempt IDs, request/context, terminal status, usage и exact-cost source без текстов книги. Возвращать durable-accepted только после подтверждения записи receipt; отдельный bounded replay применяет существующий idempotent UPSERT. Конкретный persistence backend и retention нужно выбрать отдельно. Outbox в той же зависшей БД сам по себе не гарантирует быстрый ack.
3. Явно определить поведение при невозможности подтвердить ни ledger, ни receipt. Нельзя сообщать durable success, нельзя автоматически повторять уже завершённый платный provider call только ради восстановления учёта. Также требуется явная политика для удалённой книги: текущий FK/cascade не позволяет обещать бессрочный replay/retention.

## Приёмка

- Зависший record удерживает lifecycle token до фактического settle; admission overflow не выполняет новый provider call. Нет неограниченной очереди после provider release.
- Provider permit освобождается после consume/finalize, но не раньше, включая body failure и отмену. Все release идемпотентны; нет release чужого запроса.
- Каждая принятая операция вызывает существующий recorder и дожидается его settlement; late reject обработан. Timeout не маркируется как persisted.
- Для будущего durable outbox: crash до/после ledger commit и до удаления receipt, replay одного attempt несколько раз, частично записанный набор attempts, неизвестная цена против точного нуля, удалённая книга, перегрузка и зависание persistence. Прогон только на отдельной БД/volume.

Проверено сейчас: `generation-cost-ledger.test.mjs` + `generation-cost-recorder.test.mjs` — **6 PASS** на Node24. Это behavioral тесты нормализации/обёртки и query-port тесты ledger, не доказательство реального PostgreSQL crash durability. `postgres-generation-cost-ledger.integration.test.mjs` требует `GENERATION_COST_E2E_DATABASE_URL`, выполняет insert/report внутри выделенного client transaction с rollback; в этом аудите не запускался и crash/replay не покрывает.
