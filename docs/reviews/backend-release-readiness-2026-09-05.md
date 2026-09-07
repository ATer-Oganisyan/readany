# Backend release readiness — 5 сентября 2026

## Вывод

Локально подтверждены изоляция частных книг, дедупликация повторного запроса сцены,
ограничение квот одного gateway, уникальность выдачи заданий нескольким worker и
реальная цепочка PostgreSQL → MinIO → выдача медиа. Закрыта возможность читать
неограниченное число больших source-upload в память до проверки доступа/очереди.
Финальный полный gateway прогон: **807 PASS, 0 skipped**, Node 24.20.0,
`--test-concurrency=1`, реальные локальные PG/S3 env включены; журнал
`/private/tmp/narra-audit-backend-node24-patched.log`. `actionlint` gateway workflow — PASS.

Это **не доказательство готовности обслуживать тысячи одновременно активных
читателей**. Продакшен-нагрузка, задержки/ошибки платных AI-провайдеров, длительный
soak и восстановление после отказа узла не проверялись. Деплоя в рамках этой
проверки не было. Проверенная архитектура требует ровно один gateway; worker
могут конкурировать за задания через PostgreSQL.

Рабочая база: `mishanaer/Narra`, `origin/main` `8d9d6bb`, ветка
`codex/core-loop-audit-20260904`. Локальный PG: отдельная БД
`narra_s3_audit_20260905` на `127.0.0.1:55438`. MinIO: отдельный временный каталог,
порты `59000/59001`, только тестовые учётные данные. Сетевые проверки выполнял
корневой агент; субагент запускал тесты без внешней сети.

## Исправленные релизные дефекты

### 1. Source upload занимал память до проверки доступа и import gate

В `book-catalog-api.mjs` `express.raw` стоял первым: authenticated клиент мог
буферизовать несколько файлов по 50 MiB, включая запросы к чужой книге. Общие
ограничения `/v2` не ограничивали число таких body одновременно. Quota и gate
URL-import к этому маршруту не применялись.

Теперь `book-upload-admission.mjs` до парсера проверяет private owner и срок
жизни книги, длину body и получает слот **общего** `importGate`. Read-only SQL
preflight не продлевает TTL; фактическая upload-транзакция повторяет проверку.
Затем применяются import rate/day и byte budget. Стандартные пределы:
2 активных upload/import, 2 ожидающих, source body не более 50 MiB; deadline
120 секунд включает ожидание, body и завершение операции. Это не общий лимит RSS:
парсер, S3, другие маршруты и runtime также занимают память.

`finish`, `close`, `error`, `aborted`, timeout и ошибки admission освобождают слот;
отключение отменяет S3 через `AbortSignal`. Запоздалый результат quota не запускает
следующую quota или body parser. HTTP content encoding не распаковывается на этом
binary endpoint. Две лишние копии уже готового `Buffer` убраны.

Byte budget учитывает **валидный Content-Length**, а не всегда 50 MiB. Независимый
review воспроизвёл промежуточную ошибку: семь книг по 4 KiB расходовали 300 MiB и
седьмая получала 429. Исправленный тест использует настоящий файловый journal:
7 × 4096 B проходят даже при дневном бюджете 25 MiB и списывают ровно 28 KiB.
При исчерпании оставшегося бюджета новый body не читается. Пустой declared body
отклоняется 400 до квоты.

**Ограничение:** chunked/unknown-length upload резервирует полный `uploadMaxBytes`
в дневном счётчике, а не фактически прочитанное число байт. Резервация не
возвращается после ошибки. Это консервативная защита совместимого пути без нового
протокола settlement, не точный биллинг трафика. Для объявленной длины учитывается
объявленный размер попытки, в том числе прерванной. Точность фактического сетевого
Content-Length на обеих native платформах отдельно не подтверждена.

Поведенческий RED → GREEN: четыре исходных сценария падали (read before deny,
нет gate, нет bounded concurrency, oversized header читается); итоговые
`book-upload-admission.test.mjs` — **10/10 PASS**, включая реальный `express.raw`
на Node streams, abort/cancel, delayed quota, deadline, empty/chunked и journal.
PostgreSQL preflight regression — **1 PASS, 0 skipped**: owner/foreign,
catalog/private, expired/missing, неизменность строки/TTL и повторная проверка
expiry в write-транзакции.

### 2. S3 object reader мог выделить полный body до проверки лимита

AWS SDK stream предоставляет и async iterator, и `transformToByteArray()`.
`book-object-storage.mjs` раньше сначала вызывал transform; отсутствующий или
недостоверный Content-Length обходил ограничение памяти до загрузки всего ответа.
Теперь проверка размера выполняется по мере итерации; превышение закрывает поток.
При oversized header ненужный поток также уничтожается/отменяется. Два regression
сначала упали, после исправления прошли. `putBytes` передаёт cancellation SDK и
не копирует готовый буфер. Storage suite — **14/14 PASS**.

### 3. Настоящий S3 E2E скрывался за skip и устаревшей fixture

`book-backend.e2e.test.mjs` ожидал все виды медиа за один job, хотя worker выдаёт
независимые media jobs. Fixture также могла подобрать посторонний queued job.
Генератор теперь возвращает только `requiredMedia`, claims ограничены UUID книги,
drain имеет конечный предел. Первый реальный локальный PG + MinIO прогон:
**1 PASS, 0 skipped**; окончательный целевой S3 E2E — **2 PASS, 0 skipped**,
включая private v3 scene-by-offset (`/private/tmp/narra-audit-s3-final.log`).
Медиа в тесте детерминированы; платные генераторы не вызываются.

В `.github/workflows/narra-gateway.yml` добавлен локальный MinIO той же закреплённой
версии, что в `compose.book-analysis-local.yml`, health check, test-only env и
cleanup. PG schema мигрируется до тестов, файлы выполняются последовательно,
чтобы fixtures worker не пересекались. Теперь storage E2E не должен молча
пропускаться. YAML разобран локально. Gateway CI переведён на Node 24 LTS,
Dockerfile — на `node:24.20.0-alpine3.23` с закреплённым digest; `engines >=24`
совпадает в package.json и package-lock.json. Node 20 уже EOL согласно
[официальному расписанию Node.js](https://nodejs.org/en/about/previous-releases).
Полный прогон на официальном Node 24.20.0 macOS arm64 после dependency fixes:
807 PASS, 0 skipped (`/private/tmp/narra-audit-backend-node24-patched.log`).
Локальный Linux ARM64 Alpine image build/startup также PASS: non-root health,
12 security cases, извлечение настоящего 12-страничного PDF и ffmpeg.
[Отдельный container report](backend-container-qa-2026-09-05.md) фиксирует образ,
команды и ограничения: PG/S3 проверены на хосте, не внутри контейнера; реальных
AI-запросов и deployment не было. Сам новый GitHub Actions job ещё не выполнен.

### 4. Маленький ZIP64 мог остановить обработку текста и обложки

`fflate 0.8.2` зависал при ZIP64 sentinel без обязательного extra field 0x0001.
Это [подтверждено исправлением автора](https://github.com/101arrowz/fflate/commit/e6d5e6e1076892f72770ac732d83c81da9f3316e)
и исправлено в [0.8.3](https://github.com/101arrowz/fflate/releases/tag/v0.8.3).
Gateway обновлён до `^0.8.3` с lock на 0.8.3. Regression
`test/book-source-zip64-safety.test.mjs` запускает реальные `extractBookText` и
`extractEmbeddedBookCover` в отдельных процессах (heap 96 MiB, timeout 2 s,
SIGKILL), никогда не распаковывая опасный архив в процессе тестового runner.

До обновления: четыре варианта malformed ZIP64 меньше 2 KB зависли до тайм-аута;
четыре нормальных ZIP32/ZIP64 прошли. После обновления: **8/8 PASS**, повреждённый
текст получает `BOOK_PARSE_FAILED`, необязательная обложка — `null`, нормальные
архивы сохраняют исходный многоязычный текст и обложку. Проверка независимым
агентом на Node 24.20.0: около 24–37 ms на parse вместе со стартом child.
Это устраняет конкретный ZIP64 loop; не доказывает безопасность любого zip bomb
или достаточный RSS при полной распаковке большого EPUB.

Gateway-only override `qs: 6.16.0` также проверен через зависимости настоящих
`express` и `body-parser`: **4/4 PASS**, безопасная сериализация constructor-ключа
и соблюдение arrayLimit. Это dependency regression, а не утверждение, что gateway
экспортирует все нестандартные настройки парсера из advisory-примеров.

## Подтверждённые сценарии и команды

| Проверка | Наблюдение |
| --- | --- |
| Полный gateway, все локальные PG/S3 зависимости включены | Финально **807 PASS, 0 skipped** на целевом Node 24.20.0 macOS arm64, файлы последовательно; до dependency regressions — 795 PASS |
| Локальный Linux ARM64 image | Build/startup, non-root health, 12 security regressions, Poppler PDF и ffmpeg PASS; [границы smoke](backend-container-qa-2026-09-05.md) |
| Security, registry, concurrency, catalog API/service, storage, upload admission, generation worker/queue, search | **111 PASS, 0 skipped** |
| Character/analysis/provider/regression набор предыдущего этапа | **371 PASS, 0 skipped**; не заменяет live AI quality eval |
| Один сценовый слот: 64 create + 64 terminal poll + 64 explicit retry | **192 запроса → 1 job, 2 reservations**, локальный прогон 273 ms; polling не перезапускает failed job; чужой owner не получает сцену и не расходует quota |
| 32 независимых сценовых запроса, 8 владельцев, quota 3/owner и 12 global | **12 accepted, 20 quota rejected**, rejected inserts откатываются |
| 64 параллельных worker claim | **12 уникальных jobs**, без двойной выдачи; expired lease получает новый token, stale worker отвергнут; вместе с предыдущей строкой локальный прогон 42 ms |
| PG upload preflight | **1 PASS, 0 skipped**, read-only tenant/expiry contract |
| Equal-priority analysis fairness | Другая книга получает первый shard раньше второго shard уже начатой книги; настоящий PG, без отключения immutable-run guards |

Финальные concurrency/fairness/upload-preflight вместе: **4 PASS, 0 skipped**,
root log `/private/tmp/narra-audit-pg-release-final.log`. Milliseconds в диагностике
— время короткого локального correctness probe, **не throughput/SLA продакшена**.

### Что переносить в итоговый отчёт по экранам

| Пользовательский шаг | Доказанный результат; тип измерения |
| --- | --- |
| Библиотека → импорт частной книги | Отклонённый source раньше вызывал чтение body, теперь **0 чтений** до отказа; дополнительный upload сверх gate не читает тело. Node-stream behavior, не замер UI latency |
| Импорт нескольких маленьких книг | Промежуточная ошибка: 7-я книга по 4 KiB блокировалась при бюджете 300 MiB. После: **7/7** по 4 KiB приняты даже при 25 MiB, расход **28 KiB**. Реальный локальный journal |
| Чтение → сцена → повтор после ошибки | **192** конкурирующих обращения не создали дубликаты: **1 job, 2 попытки с quota**. Не означает генерацию картинки за 273 ms: провайдер в stress не вызывается |
| Персонажи → чат → повтор отправки | Зависшие headers/body больше не держат composer бесконечно: установлен полный deadline **60 s**, затем отправка доступна. Проверено fake-timer и component regression, не live AI latency |
| Чтение → персонажи → чат | Фрагмент заново разрешается из текущего immutable CFI с обратной проверкой адреса; изменившийся live Range не используется. До **4000 символов**, bounded capture **650 ms** и проверка book/CFI/reader. Это пределы реализации и regression, не доказательство отсутствия всех спойлеров; [native rich DOM](reader-rich-context-2026-09-05.md) |
| Чтение → завершение процесса → книга | Сохранённый JSON checkpoint с точным CFI восстанавливает новую страницу поверх отстающей SQLite, не перетирая новые метаданные. Проверены движение вперёд/назад и присвоение backend identity; момент kill до самого сохранения данных не может быть гарантирован |
| Разметка персонажей | Ошибки анализа/незаземлённый ответ больше не выдаются за успешный пустой результат, Unicode-проверки русских имён/родства покрыты regression. **371** тест не является F1/precision/recall и не доказывает ускорение разметки |
| Библиотека → загрузка по ссылке → отмена → новая попытка | Раньше loading toast не давал отмены: обычная зависшая загрузка держала вход до **135 s**. Теперь Cancel сразу передаёт AbortSignal транспорту, завершает waiter и освобождает повторный импорт; поздний результат не пишет Ficbook EPUB и не вызывает importBooks. Mounted behavioral regression, без заявления native latency |
| Фикбук → загрузка многих глав | Прогресс обновляется после готовой главы как **12/100**, Cancel сохраняется. **30 s на отдельный запрос**, включая body; нового общего ограничения на длительность всей книги нет. Тест удерживает загрузку после 135001 ms и затем отменяет её |
| Импорт FBZ / вложенного FB2 ZIP → карточка | Реальные fixtures 08/09 теперь дают внутренний заголовок и **Narra Audit**, а не filename/пустого автора. Добавлен фактический store → bounded ZIP metadata маршрут; UTF-8, UTF-16 и CP1251 покрыты. Метаданные FB2 ограничены **2 MiB**, каталог ZIP **4 MiB**, полная FB2/FBZ admission — **50 MiB** распакованного XML |
| Чат → состояние ответа / профиль | Убран безусловный «онлайн» без server presence. Typing/Печатает показывается только во время активного ответа/приветствия и исчезает после timeout. Независимый review нашёл и исправил потерю открытия профиля по имени без subtitle; проверен реальный header Pressable и accessibilityRole |

Для перечисленного нет сопоставимых native замеров latency «до/после», поэтому
проценты ускорения не заявляются. Скриншоты/количество native действий и конкретные
iOS/Android артефакты ведутся корневым агентом в core-loop acceptance; Node тесты
не подменяют взаимодействие с экраном устройства.

### Дополнение: отмена URL/Ficbook и независимый mobile review

В `use-book-import-actions.ts` отмена действует только до `importBooks`.
Перед атомарным сохранением action убирается; оставшийся старый callback ничего
не отменяет. Rollback уже сохраняемой книги пользователю не обещается. Отмена
native prompt отдельна от отмены загрузки. Unmount прерывает активную загрузку,
late prompt/progress/EPUB не запускают импорт; cleanup временного файла не
превращает успешное сохранение в ошибку. Обычный URL сохраняет deadline 135 s.
Фикбук сохраняет per-request deadline 30 s и последовательное получение глав,
включая отменяемую паузу между ними и optional cover. Cancel на стадии cover
отменяет весь импорт; обычная ошибка cover по-прежнему допускает EPUB без неё.

URL/Ficbook regression: исходно **8 новых RED**, затем GREEN; отдельно RED → GREEN
проверены сохранение длинной загрузки за пределом 135 s и счётчик глав с Cancel.
Итоговый набор `import-actions`, `import-ficbook`, `local-import-toast-contract`,
`library-import`: **94 PASS**, app `tsc --noEmit` — 0, Biome — 0 ошибок.
Существующий Expo networking skill применён для lifecycle cancellation и
разделения отмены/сетевой ошибки; новая UI-система, стили и словесная локализация
не добавлялись. Native Cancel на обеих платформах в этот момент ещё не принят.

Независимый review FB2/FBZ подтвердил: 50 MiB проверяются до чтения raw XML /
compressed payload; actual inflate chunks ограничены также при поддельном размере;
обычные nested UTF-8/UTF-16/CP1251 допускаются. Store test использует реальный ZIP
parser и проверяет title/author в фактически вставляемой DB-записи, а не только
вызов mock extraction. Это устраняет прежний пропуск format `fbz` в routing.
Повторный независимый набор FB2/FBZ metadata/admission/store + character chat/
header/unification: **71 PASS** (7 suites), app TypeScript — 0. Profile title без
subtitle сначала дал настоящий mounted RED («нет доступного Pressable»), после
`subtitle || onTitlePress` — GREEN; обычный Narra title без действия кнопкой не стал.

Из корня репозитория, только на выделенной тестовой БД:

```sh
BOOK_MARKUP_TEST_DATABASE_URL=postgresql://narra_audit@127.0.0.1:55438/narra_s3_audit_20260905 \
  node --test --test-concurrency=1 \
  services/narra-gateway/test/postgres-release-concurrency.integration.test.mjs \
  services/narra-gateway/test/postgres-book-upload-admission.integration.test.mjs

node --test services/narra-gateway/test/book-upload-admission.test.mjs \
  services/narra-gateway/test/book-object-storage.test.mjs

node services/narra-gateway/scripts/reproduce-single-instance-limits.mjs
```

Последний probe намеренно завершается с **exit 2** при воспроизведении ограничения
горизонтального масштабирования. Создаёт/удаляет только свой временный каталог.
PG tests удаляют только UUID собственных fixtures; не запускать их против PROD.

MinIO локально удалось запустить **без Docker и без установки**: использован уже
имеющийся `/opt/homebrew/bin/minio`, отдельный `mktemp -d` каталог. Для повторения
S3 E2E нужны `BOOK_MARKUP_E2E_DATABASE_URL`, `BOOK_MARKUP_E2E_S3_ENDPOINT`,
`BOOK_MARKUP_E2E_S3_ACCESS_KEY`, `BOOK_MARKUP_E2E_S3_SECRET_KEY`, затем:

```sh
node --test --test-concurrency=1 \
  services/narra-gateway/test/book-backend.e2e.test.mjs \
  services/narra-gateway/test/book-scenes.e2e.test.mjs
```

Финальный root прогон обоих E2E после всех runtime изменений: **2 PASS, 0 skipped**,
`/private/tmp/narra-audit-s3-final.log`. Вторая scene E2E добавлена корневым агентом.
Cloud S3 и платные AI API для этих тестов не нужны.

## Оставшиеся риски / условия допуска

1. **Только один gateway writer.** Реальный probe двух экземпляров registry с
   одним journal показал: limit 1 → 2 reservations; revoke в первом не виден
   второму; два local gate limit 1 → 2 active. `installation-registry.mjs` и
   `concurrency.mjs` не distributed. `index.mjs` требует
   `INSTALLATION_SINGLE_REPLICA_ACK=true`; `compose.i167.yml` запускает один gateway
   по умолчанию, без `deploy.replicas` для gateway, с одним host port. Это
   эксплуатационное обязательство, не автоматическое обнаружение второго процесса.
   Исторический deployment report
   `docs/deprecated/narra-infrastructure.md` запрещает второго writer. Не включать
   gateway autoscaling/overlapping deployments до общей атомарной registry/quota.

2. **Справедливость очередей ограничена.** Analysis claims чередуют книги одного
   priority через последний обработанный shard. Generation claims сортируют
   priority → available_at → created_at (`postgres-book-markup-repository.mjs`):
   нет гарантии owner fairness/aging. Постоянные high-priority jobs могут задержать
   low-priority; пользователь с большим числом книг не равен одной книге в
   analysis scheduler. Нужны наблюдение oldest-job age, проверка распределения
   задержек по владельцам и длинный mixed workload перед ростом аудитории.

3. **Ёмкость не измерена.** При 1 GiB gateway в текущем compose нельзя независимо
   увеличивать `BOOK_UPLOAD_MAX_MIB` и `IMPORT_CONCURRENCY` до максимальных env
   значений. Выбранные defaults ограничивают ingress, но не доказывают достаточный
   RSS/CPU/headroom совместно с AI/media/search. Требуется изолированный длительный
   тест реалистичных размеров книг, aborted/retried uploads и provider delays,
   с RSS, p95/p99, очередями, ошибками и стоимостью. Платные API в этой проверке не
   нагружались.

4. **Live TEST backend недоступен.** Корневой агент получил HTTP 502 от nginx на
   `api-test.narra.disrupt.builders`; SSH alias `fun1` на этой машине отсутствует.
   Канонический runbook разрешает TEST на `fun1`, не обходным локальным provider
   backend. Полный success path с настоящими AI и native upload wire не принят;
   здесь проверены локальные deterministic pipeline и failure/recovery.

5. **CI/release gate ещё требует фактического запуска.** Полный локальный gateway
   прошёл 807/807 без skips на Node 24.20.0; это не запуск в GitHub Actions.
   Добавление PG/S3 service
   env устраняет молчаливые skips, но публикация workflow не равна его успешному
   выполнению. Локальный Linux ARM64 image build и smoke уже приняты
   ([отчёт](backend-container-qa-2026-09-05.md)). Нужны полный gateway CI
   (включая оба E2E), проверка deployment-топологии с PG/S3,
   mobile acceptance отдельно и restoration/backup drill. Нельзя переносить
   результат короткого SQL correctness stress на весь продукт.

   Alpine использует musl, поэтому тесты macOS-бинарника не доказывают работу
   контейнера. В npm lock нет install scripts/native build steps, но внешние
   системные утилиты и Linux startup поэтому отдельно проверены в Linux image.
   Digest фиксирует базовый image; `apk add` получает текущие ffmpeg/poppler
   из репозитория Alpine, то есть он не фиксирует весь итоговый filesystem.
   Gateway-only переход не меняет Node/Expo требования остальных пакетов.

6. **Мобильная приёмка ещё частичная.** CBZ blank loop и ошибочное направление
   right tap исправлены; Android подтвердил next/prev/TOC/точный reopen, iOS —
   изображения и переходы 1→4→3 с восстановлением третьей страницы. PDF получил
   отдельную визуальную приёмку: iOS без двойного текста, Android также с точным
   native выделением. URL stall→Cancel→новый prompt проверен на обеих платформах.
   Это не live Ficbook E2E и не полноценная cloud account sync. Нативные статусы
   и ограничения ведутся в отдельных [Android](android-native-qa-2026-09-05.md)
   и [iOS](ios-native-qa-2026-09-05.md) отчётах. Новый EPUB Range fast path после
   устранения несовместимого ZIP adapter ещё требует installed native AFTER.
   FB2/FBZ XML до 50 MiB всё ещё материализуется целиком при полной валидации;
   конечный лимит не равен доказанному низкому RSS на слабом телефоне. Для FB2
   metadata крупнее 2 MiB допустим filename fallback; same-hash reimport сохраняет
   уже существующее валидное название, поэтому старые filename-карточки не
   переименовываются автоматически. Автоматически различить ручной title и
   старый fallback без provenance нельзя. Полный AI success path, отсутствие
   всех спойлеров и production capacity этими локальными тестами не доказаны.

7. **iOS Characters accessibility требует отдельной native приёмки.** Найденный
   JS transition deadlock (interrupted/missing callback, rAF, StrictMode)
   исправлен bounded 600 ms watchdog + generation guards: 5 RED → GREEN,
   независимый повтор **31/31 PASS**. Но fresh initial list/Retry проходят
   mounted control-test даже до исправления. Наблюдение root «Retry виден,
   отсутствует в Maestro hierarchy на half detent» этим не объяснено; нужен
   detent/VoiceOver/native A/B. Подробности и артефакты:
   `characters-sheet-lifecycle-2026-09-05.md`.
