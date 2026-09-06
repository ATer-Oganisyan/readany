# Разметка: остановка после потери задания

## Результат

Старый scan-worker после подтверждённого `LEASE_LOST` больше не запускает
генерацию после ожидания БД или storage. Активный запрос отменяется через
generation client; поздний результат не записывается, старый worker не вызывает
`failAnalysisJob` для задания нового владельца. Продления lease не перекрываются.
Временная ошибка БД не считается потерей владения. Политика пустых чанков сохранена.

До исправления агент воспроизвёл лишнюю генерацию после задержки input/storage,
поздний commit и попытку fail после отмены; отдельно транспорт не учитывал signal.
Основной агент независимо проверил production diff и тесты, добавил настоящий
Express internal router в HTTP-проверку: отмена клиента достигает service signal,
ровно один вызов, signal не сериализуется в JSON, idempotency key сохранён.
Expo Networking использован для проверки сквозной отмены и обработки ошибки.

## Проверки финального кода, Node 24.20.0

- 44 targeted PASS, 0 FAIL, 0 SKIP: scan-worker, lease-race, transport/router,
  generation client и ранее исправленный synthesis lease-loss.
  Лог: `/private/tmp/narra-scan-cancellation-targeted.log`.
- Полный backend: 870 PASS, 0 FAIL, 21 SKIP (891 тест).
  Лог: `/private/tmp/narra-scan-backend-full.log`.
  PG/S3 environment для общего suite не задан: это не новый полный PG/S3 gate.
- Отдельный настоящий PostgreSQL replay обеих записей живой генерации:
  3 PASS, 0 SKIP. Новые собственные БД
  `narra_qa_pipeline_20260906_scanold` и `narra_qa_pipeline_20260906_scannew`.
  На каждую запись: 9 записанных ответов, 10 worker jobs, одна публикация;
  повторный lookup готового анализа не вызывает новую генерацию.
  Лог: `/private/tmp/narra-scan-pg-replay.log`.

## Параллельная клиентская проверка iOS

Изолированный LOCAL iPhone Air, dev-client build36, JS e581688:
Reader → Characters half/full → закрытие → Library → own01 Reader.
Основной агент просмотрел half/full и финальный Reader, независимо сравнил
ID, полные CFI, progress и fileHash всех трёх книг — точное совпадение.
Состояния: `/private/tmp/narra-air-sep06-baseline.json` и
`/private/tmp/narra-air-sep06-final.json`.

Первое semantic-нажатие Characters сообщило success в автоматизации, но окно
не открылось. После нового осмотра physical-нажатие открыло окно. Это открытый
риск доставки нажатия/доступности, не чистый UI PASS. Персонажи оставались
в очереди: показ готовых профилей и native AI-loop этим не приняты.

## Ограничения

Уже начатый storage GET не отменяется; после его завершения работа не продолжается.
Провайдер может успеть выполнить или тарифицировать уже отправленный запрос.
Реальный crash/reclaim с двумя процессами и PostgreSQL ещё не проверен.
Replay использует настоящую БД, но записанные ответы и memory object storage;
это не новый подписочный live-прогон и не проверка медиа.
Постоянный gateway, TEST, зависимости и нативные сборки не менялись.
