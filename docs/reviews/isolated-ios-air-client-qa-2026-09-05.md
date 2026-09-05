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
