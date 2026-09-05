# Потоковый чат: освобождение ресурса перед аналитикой

Причина двух отказов предыдущего полного backend-прогона подтверждена:
после успешного повторного stream-запроса клиент уже получал EOF, но
`ai_request_completed` ещё ожидал запись; permit освобождался только finally.
Проверка `truncated-completion-http.test.mjs:111` видела active=1 вместо0.
Это не причина потери текста и не новый автоматический повтор генерации.

Исправление public stream route освобождает permit после consumption и
finalization, до EOF/terminal analytics; catch освобождает его до failed
analytics. Finally остаётся страховкой. Освобождение строго однократное.
Аналитика сохраняется и ожидается; её существующий bounded writer не менялся.

Независимый агент воспроизвёл2 RED на настоящем извлечённом route с реальными
parser/relay/finalizer/concurrency gate. После исправления2 GREEN: до finalization
permit удерживается, во время остановленной terminal analytics следующий
запрос уже допускается, finally не освобождает повторно. Тесты не заменяют
поведение чтением исходников: извлечённый handler исполняется с deferred I/O.
Дополнительно existing real HTTP complete/stream тест прошёл5 последовательных
прогонов (10/10), без ослабления проверки или добавления polling.

Финальный полный backend: **881 PASS /0 FAIL /0 SKIP**,14.57с.
Отдельная новая БД `narra_qa_release_20260906_stream` на PostgreSQL17
127.0.0.1:55438; миграции до запуска. Собственный MinIO59100/59101 в
`/private/tmp/narra-stream-minio.h9JULG`. После тестов book_editions=0,
MinIO остановлен SIGTERM с подтверждённым завершением; схема/каталог сохранены.
Лог: `/private/tmp/narra-stream-full-pg-s3.log`.
Этот прогон включает и предыдущий synthesis lease-loss fix.

Подписочный bridge/HTTP canary model-free regressions:34 PASS; новых живых
модельных запросов не выполнялось. LOCAL/TEST gateway и устройства не менялись.
Использован Expo Networking для разделения сетевого результата и вспомогательных
операций. Не заявляется ускорение модели: error-response по-прежнему ждёт
bounded analytics, хотя provider slot уже свободен. Полный AI/media-loop,
пользовательская нагрузка и нативная приёмка этим не закрываются.
