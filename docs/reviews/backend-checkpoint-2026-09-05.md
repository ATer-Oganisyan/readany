# Повторный backend gate после PR checkpoint

Код `27661b4`, Node24.20.0. Полный `node --test --test-concurrency=1`
в `services/narra-gateway`: **870 PASS, 0 FAIL, 0 SKIP**, 15.35с.
Это локальные автоматические проверки, не производственный SLA или нагрузочная
приёмка тысячи пользователей. Модельные и медиа-ответы в E2E синтетические;
PostgreSQL и S3 transport настоящие.

Создана отдельная БД `narra_qa_release_20260905_checkpoint02` на существующем
изолированном PostgreSQL17 localhost55438. Миграции выполнены до тестов.
Финальный `SELECT count(*) FROM book_editions` вернул0: тестовые книги убраны
штатным cleanup. База со схемой сохранена, приложение её не использует.

Первый запуск с БД дал868 PASS/2 FAIL/0 SKIP: оба S3 E2E получили
`InvalidAccessKeyId`, поскольку credentials из тестового compose не подходят
существующему MinIO59000. Его настройки и данные не менялись. Для повторного
прогона запущен отдельный уже установленный MinIO, localhost59100/59101,
каталог `/private/tmp/narra-release-minio-checkpoint02.cvRxUh`, только тестовые
credentials из compose. Итоговый полный повтор870/870 использовал этот endpoint.

Логи:

- `/private/tmp/narra-backend-checkpoint02.log` — исходный отказ S3 конфигурации;
- `/private/tmp/narra-backend-checkpoint02-s3.log` — полный успешный повтор.

Без сервисов тот же backend дал849 PASS/21 SKIP. Эти пропуски не засчитывались;
последующий настоящий PG/S3 прогон закрыл их на текущем коде. Провайдеры
постоянного LOCALgateway18787 всё ещё не готовы (`llm/image/speech=false`).
Ни подписочный полный AI-loop, ни Release/archive/deploy этим не приняты.

Собственный MinIO после тестов остановлен SIGTERM; завершение процесса
подтверждено. Его временный каталог сохранён. Общие PG/MinIO и LOCAL/TEST
приложения не перезапускались этим backend-прогоном.
