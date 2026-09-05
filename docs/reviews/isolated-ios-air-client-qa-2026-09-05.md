# Изолированный iPhone Air: клиентский QA

Дата: 2026-09-05. Устройство: iPhone Air `984D0C64-C0B2-4204-92A9-2C65519089E8`, iOS 26.5, canonical build36, fingerprint CURRENT, pasteboard OFF. Действия только через canonical wrapper; TEST iPhone и Android не переключались.

## Фактически выполнено

1. Прочитаны Expo dev-client и предыдущий журнал изолированной установки. Wrapper `check` подтвердил installed36/canonical36/current. Maestro доступен; прямого native UI инструмента среди подключённых tools нет, доступен CLI через wrapper.
2. Gateway18787 `/health` отвечает; все LLM routes `configured:[]`, `ready:false`. AI функциональность не принимается.
3. Проверены порты: TEST8081 PID32155 сохранён;8082 был свободен. Через wrapper `start` поднят отдельный LOCAL8082 с env development/localhost18787/auth installation. `.env` не редактировались.
4. До запуска приложения скачаны descriptor и JS bundle8082. `/_expo/open` выдаёт корректную ссылку на localhost8082, но actual bundle использует TEST backend: обнаружен blocker ниже.
5. По согласованию root перезапущен только принадлежащий этому QA Metro8082 с `EXPO_NO_DOTENV=1`. Результат тот же. TEST8081 PID32155 не изменился. Новый8082 PID47828.
6. Приложение Air не запускалось; импорт/чтение/закладки/возврат не выполнялись и не приняты. Сохранён screenshot Air через wrapper. Native reset/rebuild/wipe не выполнялись.

## P1 QA blocker: explicit LOCAL launch env проигрывает dotenv в bundle

Шаги: запустить второй Metro через wrapper с `READANY_METRO_PORT=8082`, `READANY_NARRA_BACKEND=''`, `EXPO_PUBLIC_NARRA_GATEWAY_URL=http://127.0.0.1:18787`, `EXPO_PUBLIC_NARRA_ENVIRONMENT=development`; скачать iOS dev JS bundle, до запуска клиента проверить environment.

Ожидается: gateway accessor использует LOCAL18787, как заявляет wrapper. Фактически: HMR injection `process.env` LOCAL, но `expo/virtual/env` объединяет `{...process.env,...dotenv}` и `.env.development` перекрывает URL на TEST и environment на test. `getNarraGatewayConfig` читает именно virtual/env. Таким образом даже strict проверка Metro-порта не доказывает endpoint клиента.

Доказательство не ограничено чтением строк: QA helper `packages/app-expo/scripts/qa/inspect-bundle-gateway-env.mjs` исполняет только реальные env factories из скачанного bundle (не app/runtime код), получая:

```json
{"processGateway":"http://127.0.0.1:18787","virtualGateway":"https://api-test.narra.disrupt.builders","virtualEnvironment":"test"}
```

Одинаковый результат до и после `EXPO_NO_DOTENV=1`. Этот флаг не обходит dev virtual-env transform: установленный Expo transform-worker вручную загружает dotenv context и parseEnv. Не было изменения node_modules или очистки shared caches для обхода.

Артефакты: `evidence/isolated-ios-air-2026-09-05/01-virtual-env-before.json`, `02-virtual-env-no-dotenv.json`, `03-air-not-launched.png`. Скачанные bundle `/private/tmp/narra-local8082-qa-bundle.js` и `/private/tmp/narra-local8082-no-dotenv-bundle.js`, одинаковый SHA256 `dca75e00a1994ef6a05a2db52a12d3cb2fcfb4c9233a8946527ae8582c4bd146`.

## Следующий gate

Согласовать repo-owned precedence fix для explicit launch config без shared dotenv edits; RED/GREEN на actual env/accessor и повторно скачанный LOCAL bundle до первого Air launch. Затем собственная фикстура → чтение → закладка → возврат/CFI. Это пока план, не выполненная клиентская приёмка.

## Precedence fix: выполнено после согласования root

Wrapper передаёт reserved nonsecret launch URL/environment/auth-mode. Новый общий accessor принимает atomic URL+environment, отвергает partial/invalid profile и неверный production endpoint; без launcher values оставляет прежние defaults/production pinning. Gateway transport, credentials/cache scope, health и diagnostic fallback используют effective profile. Shared dotenv и node_modules не менялись, TEST8081 не перезапускался.

Regression gateway accessor был RED (возвращал TEST), стал GREEN; полный mobile169 suites/1523 PASS, TypeScript и bash-n PASS. Скачан новый actual8082 bundle `/private/tmp/narra-local8082-launch-override-bundle.js`; helper исполнил его реальные env+config factories: underlying virtualGateway TEST, но **effectiveProfile LOCAL18787/development/installation**. Артефакт `04-effective-launch-profile.json`. Это подтверждает config fix, не клиентскую UI приёмку; UI продолжается отдельным gate.

## Native клиентский проход после config fix

- Strict wrapper `run` открыл Air через validated deep link8082. Первое системное «Открыть в приложении Narra?» подтверждено tap «Открыть»; Expo introduction Continue привёл в dev menu. Это onboarding dev-client, не релизный экран продукта.
- Fresh Expo Tools button препятствовал Add book hit target: после попытки открыть импорт снова появлялось dev menu. Через UI прокручен dev sheet, Tools button выключен, sheet закрыт X. После этого Add book показал штатное Add from link/Choose file (`12-import-menu.png`). Первый неуспешный import flow был setup/overlay issue, не сбой сохранения книги.
- Native read-only inspector уникального Air8082 подтвердил effectiveProfile LOCAL18787/development/installation и пустую библиотеку до импорта (`09-native-local-state.json`).
- Реально выполнены Add from link → ввод `http://127.0.0.1:8089/27-fresh-boundary.fbz` (200/2199 bytes) → Add → видимая Open → tap Open → Narra Reader. Весь Maestro flow PASS, `14-import-open-cta.png`, `15-import-open-reader.png`; screenshot13 назван import-dialog по моменту запроса, фактически показывает уже reader.
- Свежая собственная книга: `44da976d-50a6-4dd8-95e7-208dbeacc4cf`, `Аудит 27 - Граница глав`, FBZ. Native CFI после открытия: `epubcfi(/6/2!/4/2[chapter-1],/2,/8/1:34)`, progress0.031068193886570464. Текст виден, p1/37.
- Add bookmark выполнен через Book actions; SQLite readonly подтверждает bookmark `f17b2774-3ef9-44cb-965a-373def5fca49` с тем же CFI. Два реальных page taps привели на p3/37; progress0.0932045816597114, CFI `epubcfi(/6/2!/4/2[chapter-1],/12/1:251,/18/1:113)`. `17-after-pages-state.json`, `18-after-pages-db.txt`.
- Bookmarks sheet реально открылся с title/Close/row/trash (`19-bookmark-panel.png`). Maestro assertVisible("Bookmarks") при этом ложно упал: UI визуально существует; возможна accessibility/automation разница. Screenshot16 — попытка, показывает reader, не доказательство списка.
- Row tap совпал с повторными HMR/bootstrap после общих runtime edits. JS inspector временно показал books=[]/contextnull при сохранённых книге, прогрессе и закладке в DB. Screenshot20 остался p3. **Exact jump не принят**, это загрязнённое обновлением кода наблюдение, не доказательство утраты данных. Root согласовал отдельное stable окно для холодного повторения.

UX наблюдение P2: на свежем Library одновременно английские Library/Popular/My books и русское «В каталоге пока нет книг» (`12-import-menu.png`). При этом успешные персонажи/сцены/озвучка не тестировались и не заявляются: LOCAL provider отсутствует.

## Stable cold gate: P1 native crash, возврат не принят

Root и второй runtime-агент подтвердили freeze; в окно не редактировались исходники, QA flows и документы. Через тот же strict wrapper выполнен холодный запуск Air8082. Wrapper exit0, но новый процесс приложения упал до Library; Maestro flow `.maestro/ios-air-local-cold-open.yaml` завершился FAIL, артефакты `~/.maestro/tests/2026-09-05_171352`. На устройстве SpringBoard (`21-cold-launch-springboard.png`), инспектор8082 пуст, процесса Narra для Air нет. TEST процесс и Metro8081 сохранены.

Это подтверждённый crash, не гипотеза по timeout: `/Users/tsevdnkanduev/Library/Logs/DiagnosticReports/Narra-2026-09-05-171350.ips`, 17:13:50+0300, build36, PID91615, exact Air UDID, `EXC_BAD_ACCESS / SIGSEGV`, faulting thread8. Верх stack: `objc_msgSend → mdict_rehashd → -[__NSDictionaryM setObject:forKey:] → -[EXPermissionsService registerRequesters:] (EXPermissionsService.m:35) → ImagePickerModule.definition (ImagePickerModule.swift:29)`. Краткое доказательство `23-cold-crash-summary.json`, полный сохранён `/private/tmp/narra-air-cold-crash-171350.ips`; wrapper logs `/private/tmp/narra-air-cold-logs.txt`. Причина гонки/памяти ещё требует независимого native review — stack сам по себе не доказывает конкретное исправление.

SQL **после падения** подтвердил книгу и закладку без потери последнего прогресса (`22-after-crash-db.txt`): own44da... progress0.0932045816597114/CFI p3, bookmark f17.../CFI p1. Порт8082 descriptor по-прежнему выдаёт правильную LOCAL Metro ссылку; процесс Metro55388 жив, TEST8081 PID32155 неизменен.

Итог bounded прохода: импорт→Open→чтение, add bookmark, paging и сохранение в DB PASS; визуальный bookmarks panel PASS с accessibility ambiguity. **Exact jump, холодный возврат и полный core loop НЕ приняты**. После доказанного crash никаких слепых restart/rebuild/reset не выполнялось; freeze освобождён, передано root и независимому native reviewer.

## Второй native candidate: другой crash до первого QA-действия

После root canonical rebuild/install (compile исправленного `ExpoReactNativeFactory.mm`, fingerprint `b4842db0752f…`) кратковременно появился LOCAL runtime. Получив GO, QA выполнил только read-only inspector и screenshot: приложение уже отсутствовало, на экране SpringBoard. Ни одного UI tap, повторного cold start или reload QA до этого падения не запускал.

Новый crash зарегистрирован **17:25:33+0300**, build36, PID5829, **EXC_BREAKPOINT/SIGTRAP**, main thread0. Это не прежний permissions SIGSEGV: stack идёт через `ExpoFabricView.injectInitializer`, `ExpoFabricView.swift:212`, затем `RCTComponentViewFactory`. В логе в17:25:22.476 точный fatal: **“The app context has been lost”**. UUID именно новой `Narra.debug.dylib`: `06cb188a-fa70-3198-b921-d83b7f78904f`; UUID launcher в header crash не использовать для идентификации этой правки. Безопасный summary: [24-second-crash-sanitized.json](evidence/isolated-ios-air-2026-09-05/24-second-crash-sanitized.json). Полный unified log в репозиторий не добавлялся.

При установке изменился UUID data container; старый путь больше не существует. После разрешения **нового** пути через wrapper, read-only SQL подтвердил прежние собственную книгу, progress0.0932045816597114/CFI p3 и bookmark/CFI p1: [25-second-crash-own-fixture-db.json](evidence/isolated-ios-air-2026-09-05/25-second-crash-own-fixture-db.json). Это подтверждение сохранности данных, не работоспособности восстановления UI.

Серия из пяти запусков **не начата**, bookmark jump и cold restore всё ещё не приняты. QA остановлен на первом новом crash; root и независимый native reviewer получили evidence. Ожидается следующий явно согласованный GO, без самовольных перезапусков или изменений устройства.

## Третий native candidate: первый рабочий проход, повторный старт падает

Root установил build36 с narrow nil-context Fabric patch, fingerprint `b56c713d0293…`; исходники оставались заморожены. Первый свежий запуск дал настоящую Library с own27/9%, затем реальный tap книги открыл текст p3. Inspector подтвердил прежний CFI `epubcfi(/6/2!/4/2[chapter-1],/12/1:251,/18/1:113)`. Root независимо посмотрел оба кадра. Через Book actions → Bookmarks показана полноценная панель с заголовком, Close и строкой; Maestro assert заголовка опять оказался false negative, поэтому отдельно проверен screenshot. Реальный tap строки закладки прошёл: inspector 14:31:46 UTC вернул **точный CFI p1** `epubcfi(/6/2!/4/2[chapter-1],/2,/8/1:34)`, progress0.031068193886570464. Это принятые restore/jump только первой сессии.

Второй strict wrapper cold start создал PID17543 и LOCAL runtime, но рабочая Library повторно не принята. Пока Maestro ожидал Library, приложение исчезло: screenshot показывает SpringBoard, процесс Air отсутствует, crash report `Narra-2026-09-05-173346.ips` содержит captureTime **17:33:35.679+0300**, EXC_CRASH/SIGABRT, termination namespace OBJC, main thread0. Верх stack: `getMaybeUnrealizedNonMetaClass → resolveMethod_locked → class_respondsToSelector_inst → NSBundle.bundleForClass → UIAccessibilityAutomation snapshot`. UUID новой debug dylib `96c1de24-7f4f-3a4c-98a9-19f9fb067b89`. Автоматизация вызвала accessibility snapshot; это не доказывает ни исключительно tester issue, ни конкретную причину повреждённого объекта.

Wrapper logs за последнее окно содержат **41** сообщение `Cannot create a view … The app context has been lost`, начиная17:32:04 для второго PID17543 (HostView, PickerView, SlotView, ContextMenu и другие). Значит защита действительно срабатывала, но повторный startup всё равно не прошёл. Эти события нельзя приписывать первой принятой сессии. Полные unified logs остаются только `/private/tmp/narra-air-fabric-gate-logs.txt`, не включены в репозиторий.

Readonly SQL после crash подтвердил книгу own44da… и bookmark f17…: оба CFI p1, book progress0.031068193886570464 — jump успел сохраниться. **Итог: 1 рабочий startup из запланированных5; второй упал, оставшиеся3 не выполнялись.** После первого нового crash дальнейшие device actions прекращены. Это не soak и не приёмка стабильности релизной сборки. Приложены [sanitized summary](evidence/isolated-ios-air-2026-09-05/26-third-candidate-sanitized.json), [Library](evidence/isolated-ios-air-2026-09-05/27-third-library.png), [Reader restored](evidence/isolated-ios-air-2026-09-05/28-third-reader-restored.png), [bookmark jump](evidence/isolated-ios-air-2026-09-05/29-third-bookmark-jump.png), [SpringBoard после падения](evidence/isolated-ios-air-2026-09-05/30-third-crash-springboard.png). Дополнительные read-only состояния сохранены в `/private/tmp/narra-air-fabric-restore1.json` и `/private/tmp/narra-air-fabric-jump1.json`.

## Четвёртый candidate: registered base fallback сохраняет процесс, но теряет controls

Build36, fingerprint `f8e1ef3dd11a…`, только изолированный Air/LOCAL8082; gate **17:38–17:40+0300**. Исходники заморожены. Уже первый root startup показывает degraded Library: own27/3% видна, но отсутствует переключатель My books/Catalog, а под обложкой отдельно видна красная trash icon. AX flow находит Library, но не My books (`.maestro/tests/2026-09-05_173836`). Это не только selector issue: отсутствие видно на [кадре31](evidence/isolated-ios-air-2026-09-05/31-base-fallback-library-missing-picker.png).

Для уточнения масштаба выполнен один безопасный tap видимой собственной обложки (25%,40%): открылся полноценный текст Reader p1. Native inspector14:39:33 UTC подтвердил точный CFI `epubcfi(/6/2!/4/2[chapter-1],/2,/8/1:34)` и LOCAL профиль; readonly SQLite совпал. Отдельный AX hierarchy завершился без падения. Но center tap (50%,50%) не дал доступного Book actions: следующий фактический flow завершился `Element not found: Book actions` (`.maestro/tests/2026-09-05_173948`), [кадр32](evidence/isolated-ios-air-2026-09-05/32-base-fallback-reader-missing-controls.png) также без native controls. Bookmarks UI поэтому blocked-by-product, не принят.

В выбранном wrapper log-окне `/private/tmp/narra-air-base-gate1-logs.txt` **41** `Cannot create a view … app context has been lost` для текущего PID26645 с17:38:08. Нового crash report к концу bounded проверки нет (последний остаётся17:33:46 предыдущего candidate). Отсутствие crash **не означает работоспособность**: при сохранном тексте и DB исчезли ключевые native элементы интерфейса.

Итог: **0 полностью принятых сессий / 1 попытка / 5 запланированных**. Следующие4 cold starts не запускались после доказанного visible-UI failure. Никакого отключения AX, очистки данных или дополнительных rebuild. Gate освобождён; root получил evidence и точный blocker.

## SceneDelegate root-cause candidate: bounded native gate принят

Build36, fingerprint `b7e9985e4b5b…`; root canonical rebuild `/private/tmp/narra-air-scene-startup-fix-build.log` перед GO. Окно **17:45–17:54:50+0300**: только Air/LOCAL8082, source freeze, без отключения AX, сброса библиотеки или действий с TEST. Expo dev-client skill использован для работы с существующей нативной сборкой; все simulator actions через canonical wrapper.

**Пять из пяти холодных сессий приняты.** Первая — свежий root launch, ещё четыре — strict wrapper run. После каждого: Library с Popular/My books → реальный tap My books → own27 → полноценный Reader → Book actions → видимая Bookmarks с Close/строкой/trash → tap строки. AX участвовал во всех flows. Inspector подтверждает exact CFI p1 `epubcfi(/6/2!/4/2[chapter-1],/2,/8/1:34)`. PID по порядку:37694,43946,46910,52611,54786. В третьем сценарии первый center tap скрыл ещё видимые initial controls; bounded повтор открыл меню успешно. Исправлен только QA flow: center tap выполняется лишь при отсутствии Book actions. Это tester toggle, не повторение degraded native UI. Root независимо подтвердил восстановленный picker и отсутствие лишней trash icon.

**Дополнительная шестая cold-сессия исключила ложный успех «всегда начало».** Два page taps довели own27 до p3: CFI `epubcfi(/6/2!/4/2[chapter-1],/12/1:251,/18/1:113)`, progress0.09320458165971139. До restart14:51:12 UTC и после реального Library→book14:51:52 UTC CFI совпал точно, PID58515. Текст p3 виден, не только запись DB.

**Приоритетный импорт:** создана исключительно новая собственная FBZ30 (новые title/document-id/archive bytes, exclusive file creation), fixture8089 ответил200/2210B. Actual Add book → Add from link → URL → Add → Done/Added1/failed0 → Open → Reader прошёл. SQLite и inspector подтвердили именно новую книгу `d9d5f55a-a220-4d9e-a85c-443212d1384e`, «Аудит 30 - Импорт после исправления запуска». Затем Choose file открыл настоящий системный Files picker (первый автоматический кадр был слишком ранним; принят отдельный поздний screenshot). Tap X отменил выбор, Library и Add book восстановились. Ничего из чужих файлов не выбиралось. Возврат в own27 подтвердил прежний p3 CFI14:53:33 UTC.

**Warm dev-client reopen:** Maestro openLink той же ссылки из actual `8082/_expo/open` без terminate/rebuild прошёл в том же PID58515. После reload полноценные Library/My books → own27 Reader → Book actions → Bookmarks → Close. Final14:54:50 UTC: p3 CFI неизменен. Это один controlled warm reopen, не серия произвольных HMR/reloads.

В перекрывающихся captured wrapper log-окнах для **этих шести PID** найдено **0** `Cannot create a view`/nil-context fallback. Новых crash reports нет; последний файл17:33:46 относится к прежнему candidate. Полные логи оставлены только в `/private/tmp`, не помещены в репозиторий. Доказательства: [sanitized summary33](evidence/isolated-ios-air-2026-09-05/33-scene-startup-gate-sanitized.json), [Library34](evidence/isolated-ios-air-2026-09-05/34-scene-fix-library.png), [Bookmarks35](evidence/isolated-ios-air-2026-09-05/35-scene-fix-bookmarks.png), [noninitial restore36](evidence/isolated-ios-air-2026-09-05/36-scene-fix-noninitial-restored.png), [import Open37](evidence/isolated-ios-air-2026-09-05/37-scene-fix-import-open.png), [new Reader38](evidence/isolated-ios-air-2026-09-05/38-scene-fix-import-reader.png), [Files39](evidence/isolated-ios-air-2026-09-05/39-scene-fix-files-picker.png), [cancel40](evidence/isolated-ios-air-2026-09-05/40-scene-fix-files-cancel.png), [warm Bookmarks41](evidence/isolated-ios-air-2026-09-05/41-scene-fix-warm-bookmarks.png).

Граница вывода: принят **bounded startup/restore/import smoke** на одном изолированном iOS simulator dev-client. Это не длительный soak, не релизная сборка/физический iPhone, не повтор всей матрицы форматов, не проверка успешных AI/TTS. LOCAL provider не настроен, успешную генерацию не заявляем. Gate завершён, freeze освобождён; продуктовый код в этом проходе QA не менялся.
