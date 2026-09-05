# Остаточные барьеры импорта и сохранности источников

Дата: 2026-09-05. Проверяется worktree от `mishanaer/Narra` / `8d9d6bb`, не production.
Этот документ дополняет [критерии core loop](core-loop-acceptance-2026-09-05.md)
и [матрицу форматов](import-acceptance-2026-09-05.md). Успех теста с подставленной
сетью не означает успешный вход через настоящий сервер или системный picker.

## Подтверждённые дефекты и исправления

| Дефект до изменения | Поведенческое доказательство | Исправление и проверка |
| --- | --- | --- |
| Облачный download заменял прежние байты до проверки пустого файла; mobile `copyFile` предварительно удаляет destination | Настоящий `downloadBookFile` с виртуальными файловой системой/БД: пустой download уничтожает прежний файл | Книга скачивается в новый управляемый artifact; положительный размер, полнота копии и mobile container validation проверяются до DB pointer switch. Empty, partial-copy, corrupt-container, DB failure сохраняют старые bytes/pointer; удаляется только новый artifact |
| Даже при сохранении файла неудачный refresh ставил `sync_status=remote`, закрывая прежний офлайн-доступ | Пять RED: empty, partial-copy, corrupt-container, DB failure, 404 при прежнем local source | При существующем непустом local source статус сохраняется. Отсутствующий formerly-local source остаётся retryable remote; пять RED → GREEN плюс negative control |
| Следующая синхронизация могла читать canonical path и удалить новый download artifact как «сироту»; входящие метаданные сбрасывали pointer | Реальное исполнение `syncFiles` с перечнем фактических файлов и applyChanges с in-memory DB | Используется текущий безопасный `books/<leaf>`; metadata sync сохраняет local pointer только для совпадающего непустого `file_hash`. Иной источник становится remote. Последующий upload читает новую книгу и не удаляет её |
| Поздняя обложка каталога возвращала старые title/description | Deferred cover завершён после изменения metadata: прежние данные затирались | Узкий `{ meta: { coverUrl } }` и merge с актуальным store; DB обновляет только переданные metadata columns. Два RED → GREEN (catalog callback и настоящий store) |
| Repair picker не предлагал CBZ и FB2 ZIP, доступные обычному импорту | Два provider-filter теста возвращали пустой выбор для `application/x-cbz` и `application/zip` | Общий `BOOK_IMPORT_MIME_TYPES` для hook и `open-mobile-book`; отдельный ReaderScreen repair также переведён на него. Нативный missing-source repair проверяется отдельно |
| После 404 запрос своей книги принимал любую другую с тем же очищенным названием | Два RED: actual download с local/remote записью возвращал `ok` и переключал pointer на байты другого UUID, сохраняя не соответствующий им CFI | Cross-UUID title/folder fallback удалён. Сохраняются old bytes/pointer/status/CFI; чужой UUID не скачивается. Same-UUID new/legacy compatibility продолжает проходить тесты |

Основные файлы: `core/src/sync/sync-files.ts` (`stageBookDownload`, `downloadBookFile`,
`cleanupLocalOrphans`), `local-book-paths.ts`, `simple-sync.ts`,
`app-expo/src/lib/sync/sync-adapter-mobile.ts`, `backend-catalog-import.ts`,
`stores/library-store.ts`, `lib/library/open-mobile-book.ts`.

Новые artifacts никогда не используют абсолютный путь другого устройства,
`..`, encoded traversal или вложенный каталог из удалённой записи. Старые
пользовательские файлы при ошибке/успехе refresh не удаляются. При передаче
FBZ с расширением `.zip` валидатор получает сохранённый `format=fbz`.

## Что покрывает каждый вход

| Вход / переход | Исполняемое покрытие | Что не доказано этими тестами |
| --- | --- | --- |
| Library → local picker → импорт / смешанный batch | Mounted `import-actions.test.tsx`; реальный store `library-import.test.ts`; реальные parser/codec/ZIP fixtures; отдельные native отчёты iOS/Android | Каждый document provider, очень большие контейнеры, старые устройства; системный picker не эмулируется unit-тестами |
| Library → URL | Mounted prompt/download/cancel/late response/second import; native Android localhost success/redirect/stall/cancel и safe Details | Произвольные внешние серверы, долгие production downloads. UI-driver latency не равна времени импорта |
| URL → Ficbook | Реальный parser с ответами fixtures, per-request timeout, abort зависшего body, отменяемые паузы между главами, chapter progress и late-result guard | Полная книга с текущего живого Ficbook в native этой кампанией не подтверждена. Общего 135-секундного лимита Ficbook нет: 30 секунд на запрос и ручная Cancel |
| Backend catalog → download → import | `backend-catalog-source`, `backend-file-download`, `backend-catalog-import`, `catalog-import-coordinator`: ownership временных файлов, retry/re-sign, отмена, single-flight, commit после unmount, поздняя обложка | Live backend catalog success при недоступном test API не проверен. Render-тест `catalog-chat-render` не нажимает настоящий download |
| Bundled catalog → Reader | Ветка Reader route существует; используются общие store/validator и узкое обновление cover | Активный путь текущего UI с `catalogBookId` не установлен этим review. Matching по title не доказывает совпадение издания |
| Cloud download из Library | Четыре mounted `cloud-download-actions` проверяют single-flight и recovery статуса; COW tests выполняют core download и полный sync; настоящий mobile range reader проверяет контейнеры | Реальные настроенные WebDAV/S3 endpoint, credentials, download/cancel/retry на iOS/Android не проверены. Локальный backend MinIO E2E — другой путь, не доказательство mobile cloud sync |
| Reading / Notes / Profile / Chat → Reader | По коду используют `openMobileBook`: ReadingTab:55, NotesView:282 с CFI, NarraCharacterProfile:68, ChatScreen:312. Функция протестирована для local/remote/missing-source; mounted Profile проверяет карточку/Retry/chat | Нет самостоятельного mounted сквозного cloud/repair теста для каждого экрана; Profile тест mock-ит `openMobileBook`. Общая функция снижает дублирование, но не заменяет native навигацию |
| Missing-source repair | `open-mobile-book.test` + настоящие store restore tests, согласованные picker MIME; Android Library → CBZ Re-import → настоящий picker → прежние id/hash/CFI `/6/4`, стр. 2/4 | Android Library CBZ подтверждён [нативным отчётом](android-native-qa-2026-09-05.md); iOS и отдельные Notes/Profile repair не проверены этой записью. Тест MIME сам по себе не является native picker evidence |
| WebDAV import browser | Зарегистрирован в RootNavigator; core `webdav-import-service.test` проверяет paths/formats/discovery на fixtures | Активный переход из Library не найден; mounted browser и live WebDAV E2E отсутствуют. Не объявлять канал ни доступным, ни прошедшим native приёмку |
| Share-in / «Открыть в NARRA» | Найден только экспорт через expo-sharing | Входящий native file-handler не найден; не заявлять эту возможность |

## Открытые риски, не замаскированные зелёными тестами

1. **Legacy cloud identity и осознанное fail-closed поведение.** Опасный
   cross-UUID title fallback теперь отключён после воспроизведения подмены.
   Если отдельно импортированная на другом устройстве книга имеет иной UUID,
   она больше не используется для автоматического восстановления этой записи
   только по названию. Нужен upload исходного файла с устройства-владельца или
   явный reimport/repair; same-UUID legacy flat path сохранён. Это изменение
   безопасности, а не восстановленная дедупликация всех старых библиотек.
   Нельзя просто сравнить нынешний
   `MobileSyncAdapter.hashFile` (SHA256 от base64) с `file_hash`: существуют MD5,
   raw SHA256 и исходники TXT/UMD, отличающиеся от преобразованного EPUB. Нужны
   явная версия алгоритма/идентичности для миграции hash. Она в этот fix не входит.
2. **Cloud download native gate и границы deadline/cancel.** Найденный пропуск
   timeout в `WebDavClient.getFileToPath` исправлен основным агентом:
   `TRANSFER_TIMEOUT_MS=300000` передаётся в Expo service, который независимо
   завершает caller через abort race, даже если native promise игнорирует отмену.
   Независимо проверены четыре actual WebDAV → Expo tests со stalled native task:
   timeout/retry, caller abort/late rejection, precancel и success/progress/cleanup.
   Новые timeout/cancel messages не содержат URL. Raw native exceptions всё ещё
   могут содержать сетевые/файловые сведения — прежняя граница диагностики.
   **300 секунд — на попытку**, new+legacy могут занять два таких периода;
   общей ручной Cancel в cloud UI этот patch не добавляет. Реальный native Expo
   transport к локальному fixture endpoint уже проверен на iOS и Android:
   stalled body→TimeoutError, retry, precancel, отсутствие позднего progress,
   cleanup. Это не полный путь WebDAV/S3 account sync с настройкой credentials,
   metadata merge и COW pointer switch; он остаётся отдельным gate.
3. **Неактивный WebDAV browser требует отдельной приёмки перед включением.**
   `screens/library/WebDavImportBrowserScreen.ts:524` сначала скачивает все файлы,
   затем всегда делает `toast.success`, даже при результате с одними failures;
   catch отображает raw exception. Общая отмена/unmount guard не видны.
   `core/src/import/webdav-import-service.ts:186` рекурсивно собирает папки без
   ограничения глубины/числа entries. Это review существующей неустановленной
   UI-ветки, не новый native repro и не основание заявлять исправление.
4. **Цена безопасного retention.** Старый source не удаляется после pointer
   switch. Cleanup консервативно сохраняет download artifacts живой книги,
   включая возможный artifact процесса, погибшего до commit. Частые forced
   refresh, повторные TXT/UMD-конверсии и обложки могут накапливать файлы.
   Нужна отдельная bounded GC/lifetime-политика с тестом активного reader/transfer;
   существующий файл не удаляется «на глаз» ради экономии места. Cover replacement
   не получил транзакционность book source.
5. **Hash reuse: кандидат не подтвердился для текущего импорта.**
   `library-store.ts:246` сейчас всегда возвращает `md5: undefined`, даже если
   native stat содержит MD5; обычный generic import использует raw SHA256.
   Поведенческий тест с native 32-hex MD5 и helper 64-hex SHA256 сохраняет тот же
   artifact/id без копии. Старые строки с MD5 могут не дедуплицироваться с новым
   SHA256 — это legacy identity/migration ограничение, не исправленная миграция.
6. **Масштаб и устройства.** Парсерная проверка не доказывает отрисовку каждой
   страницы, исправность storage при kill в любой инструкции, отсутствие утечек
   в длительной native сессии или production capacity. Большие книги, облачный
   success/retry, release-сборка и конечный native loop остаются отдельными gates.

## Повторяемые проверки этого handoff

```sh
pnpm --filter @readany/core exec vitest run src/sync/__tests__/simple-sync.integration.test.ts src/sync/__tests__/sync-download-safety.test.ts src/sync/__tests__/sync-files.test.ts src/db/__tests__/book-queries.test.ts
pnpm --filter @readany/app-expo exec vitest run src/lib/book/sync-download-validation.test.ts src/lib/book/library-import.test.ts
pnpm --filter @readany/app-expo exec tsc --noEmit
git diff --check
```

Фактически в этом handoff: core **87 PASS**; actual mobile cloud validation
**4 PASS**; library store с проверкой hash reuse **41 PASS**. TypeScript и
`git diff --check` — exit 0 до финального общего root-прогона. Core 87 включает
более старые регрессии; числа не являются количеством новых багов. Новые
sync-status тесты реально падали **5 RED**, затем прошли; fail-closed title
regressions **2 RED → GREEN**. Hash reuse тест прошёл
без runtime patch и не выдаётся за RED→GREEN исправление.

Нативные результаты, изменение счётчика Added/Updated и финальный Node 24
общий прогон ведутся основным агентом и в отдельных platform reports.
Этот локальный этап не закрывает перечисленные release gates.

## Возобновлённый независимый прогон

2026-09-05, 11:22:12 local shell: `pnpm --filter @readany/core test` —
**77 файлов, 624 PASS, 0 skipped**, exit 0. Включены все актуальные COW,
fail-closed и same-UUID legacy regressions. Это полный core-набор, а не
добавочные 624 теста сверх целевых 87. Runtime shell **Node 26.8.1**;
результат не выдаётся за gateway Node 24 или production/native capacity.
Дополнительный повтор import/feedback/cloud-deadline: **9 файлов, 165 PASS**.

Повторный независимый review root deadline patch не нашёл новых блокеров:
таймер и listeners снимаются в finally, task release выполняется один раз,
поздняя native ошибка наблюдается Promise.race, поздний progress игнорируется.
Ограничения per-attempt deadline и отсутствующей cloud UI Cancel сохранены выше.

После окончательного autosave/store исправления независимый полный core повтор:
**79 файлов, 639 PASS, 0 skipped**, Node 26.8.1 (11:35:22). Другой агент также
подтвердил 639/639 на целевом Node 24. Это актуальнее исторических 624 выше,
но по-прежнему не замена native cloud E2E или crash-durability проверке.
