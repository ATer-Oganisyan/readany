# Независимый клиентский QA — 5 сентября 2026

## Правила прохода

Android emulator-5554, `com.mishanaer.readany.dev`, существующий dev-client через локальный Metro. Только собственные QA-книги; пользовательскую книгу не открывать и не изменять. Действия выполняются реальными нажатиями; inspector используется только как подтверждение позиции/состояния. iOS зарезервирован основным агентом. Runtime-код этот QA-агент не меняет.

План прохода: Library → собственная книга → закладки (создать, список, переход, удалить свою) → заметки → общий раздел разговоров/персонажи → возврат → импорт по ссылке (ошибка, отмена, повтор). Каждый пункт получает отдельное подтверждение, не заменяется общим числом unit-тестов.

## Начальное состояние: найден нативный crash

До первого QA-нажатия на экране стоял системный диалог **Narra keeps stopping**. Поэтому причинный пользовательский сценарий неизвестен; crash не приписывается проверке закладок.

- 14:51:52 MSK: `SIGSEGV` в `mqt_v_js`, стек `MountingCoordinator::pullTransaction` / `libreactnative.so`.
- 14:52:09: второй fatal — `ForegroundServiceStartNotAllowedException` при `MusicService.onStartCommand(null)` / `startAndStopEmptyNotificationToAvoidANR`.
- Android 16/API 36, arm64 emulator. Для определения release-impact требуется отдельная проверка вне Fast Refresh.
- Приоритет: P1, кандидат в блокер релиза до выяснения воспроизводимости. Это не доказательство того, что любой запуск падает.

Доказательства: [системный диалог](evidence/continuous-product-qa-2026-09-05/00-existing-crash.png), [UI hierarchy](evidence/continuous-product-qa-2026-09-05/00-existing-crash.xml), [полный crash buffer](evidence/continuous-product-qa-2026-09-05/00-crash-log.txt). Разбор передан отдельному агенту `android_crash_review`.

Действия восстановления: Close app → открыть MainActivity → Expo dev launcher → Recently opened Narra. Данные не очищались. Появился белый экран с dev tools; logs показали новый bootstrap и повторный запуск JS. В этот момент основной агент изменял исходники: время cold start и стабильность запуска пока не принимаются, влияние Fast Refresh отделяется от продуктового сценария.

## Выполнение сценариев

Ожидается стабильный запуск после обновления asset. До него список/переход/удаление закладок, заметки, чаты и URL-пути в этом независимом проходе **не приняты**.

### Завершение эмулятора во время восстановления

После наблюдения повторных JS bootstrap `maestro` сообщил `Device emulator-5554 was requested, but it is not connected`. Перепроверено: `adb devices` пуст; qemu/emulator-процесс отсутствует; порты 5554/5555 закрыты; adb server PID 86559 и порт 5037 живы. Это подтверждённое завершение процесса, не observation timeout. Root не закрывал эмулятор. Причина завершения пока не установлена; продуктовой ошибкой NARRA без дополнительных доказательств не объявляется.

Для продолжения выбран существующий `Readest_API_36_arm64`, обычный `emulator -avd Readest_API_36_arm64`, без `wipe-data`, сброса snapshot, переустановки приложения или очистки библиотеки. Первоначальный тестовый gate `.maestro/android-continuous-qa-library.yaml` не прошёл: устройство отсутствовало, а не assertion приложения.

### Устаревший quickboot snapshot: ошибка QA-окружения

Обычный запуск загрузил `default_boot` от 10 августа. В этой загрузке `pm list packages -3` показывает только `xyz.block.buzz.mobile`; NARRA отсутствует. Имя AVD подтверждено предыдущим `android-native-qa-2026-09-05.md`, то есть выбран тот же AVD. Предыдущий emulator log тоже начинался загрузкой этого snapshot, после чего в прошлой кампании ставилась NARRA. Нельзя было считать обычный restart нейтральным для unsnapshotted QA-состояния. Это ошибка восстановления тестового окружения, не доказанный дефект потери данных NARRA.

Согласовано сохранение перед дальнейшими действиями. Повторно проверен процесс PID 53965: `qemu-system-aarch64 -avd Readest_API_36_arm64`. Только он заморожен `SIGSTOP`. APFS clone создан в `/private/tmp/narra-avd-preserve-20260905.WZg691/Readest_API_36_arm64.avd` (7.5 GiB по du), отдельно сохранён `.ini`. Clone включает backing `userdata-qemu.img`, `userdata-qemu.img.qcow2`, custom userdata, encryption/cache, snapshots и конфигурацию. Старый snapshot вручную не сохранялся и не удалялся. Экспорты предыдущих QA SQLite DB/WAL в `/private/tmp/narra-android-note-*.db*` не менялись.

План безопасной проверки после clone: остановить только замороженный owned PID без quickboot save, затем cold boot того же AVD с `-no-snapshot-load -no-snapshot-save`. Возврат unsnapshotted данных не гарантируется. Переустановка приложения или восстановление DB без отдельного решения запрещены в этом проходе.

Результат восстановления: `cmp` исходного/клонированного `userdata-qemu.img.qcow2` завершился с кодом 0. Замороженный PID 53965 остановлен точечным `SIGKILL`, чтобы не сохранить quickboot. Новый процесс PID 57395 запущен с обоими `-no-snapshot-*` флагами; `sys.boot_completed=1`. После cold boot NARRA по-прежнему отсутствует, `pm list packages -3` содержит только `xyz.block.buzz.mobile`. Прежняя QA-библиотека не восстановлена; это не скрывается повторным импортом. Для возобновления прохода требуется решение основного агента о восстановлении проверенной APK и собственных fixtures/данных или отдельном QA AVD.

## Итог первого ограниченного прохода

- Выявлен и сохранён реальный нативный crash до первого QA-действия; [независимый разбор](android-crash-triage-2026-09-05.md) отделяет reload/Fabric lifetime от последующего TrackPlayer restart.
- Не принято ни одного из запланированных bookmark/notes/chat/URL сценариев: работа остановлена на восстановлении окружения. Нельзя заменять это прежними зелёными тестами.
- Создан повторяемый Library UI gate, но его выполнение завершилось отсутствием устройства; это не баг Library.
- Runtime-код, пользовательские книги и исходные DB-экспорты агент не редактировал. Старый quickboot привёл к откату QA-состояния; создан полный clone и проверен cold boot, без ложного заявления о сохранности прежней библиотеки.
- Следующая итерация: восстановленное согласованное Android QA-окружение → реальное добавление/переход/удаление только собственной закладки → холодное открытие → заметки/чаты → ошибки импорта. После каждого исправления повторяется именно упавший маршрут и соседние пути; постоянная фоновая работа без живого процесса не обещается.

## Итерация 2: fresh QA install, не восстановление старой библиотеки

По решению root установлена существующая APK `android/app/build/outputs/apk/debug/app-debug.apk`: SHA256 `371fbe3983c5b2bfb8154d4505082ffc2f3a9cda7670b1dd623a8212ca01c8db`, размер 119155749, mtime 5 сентября 01:07. `aapt` подтвердил package `com.mishanaer.readany.dev`, versionName 1.3.5/versionCode 1, SDK36. Native BuildID падавшей RN-библиотеки проверен отдельным triage; полной самодостаточной fingerprint-проверкой это не считается. Другие приложения не изменялись. Старые DB не восстанавливались.

Через настоящий Android picker импортирована собственная `27-fresh-boundary.fbz`: Library → Add book → Choose file → корень sdk_gphone64_arm64 → Download → NarraContinuousQA → файл. Карточка «Аудит 27 — Граница глав» появилась, книга открылась. Фактический reader asset MD5 `d2d784450bc7599028e407282906c8a5`. Отдельный тестовый промах: плавающий Expo dev tools перекрывал Add book; после его перемещения файловый маршрут прошёл. Ошибка Maestro Choose file в этом случае не является дефектом импорта.

### P1: отсутствует путь к списку закладок

Шаги: страница 2 → Book actions → Add bookmark → два физических next → Book actions → Table of Contents. Ожидание: открыть сохранённые позиции, узнать нужную, перейти/удалить. Факт: Book actions содержит только оглавление, добавление текущей закладки, персонажей, заметки, озвучку. В оглавлении только 3 главы, нет списка/вкладки закладок. Runtime route поиска `BookmarkList`/`BookmarksScreen` отсутствует; preview не заменяет рабочий экран. [Скриншот](evidence/continuous-product-qa-2026-09-05/11-toc-no-bookmarks.png), [hierarchy](evidence/continuous-product-qa-2026-09-05/11-toc-no-bookmarks.xml). Root принял дефект в исправление.

Само сохранение подтверждено read-only копией SQLite: bookmark `4b82b771-5b43-4e61-bed6-7512c6e4bcc2`, книга `911e07fc-a7ed-481c-ab5d-580a316d4f40`, CFI `epubcfi(/6/2!/4/2[chapter-1],/8/1:74,/12/1:286)` совпадает с captured page. Два prev физически вернули страницу; меню стало `Remove bookmark from this page`. Нажатие удалило запись: `bookmarks=0`, `sync_tombstones=1`. Это не приёмка отсутствующего list/jump UX. Таблицы `bookmark_delete_commands` в этой runtime DB не было, поэтому новая atomic реализация здесь не принята.

P2: snippet закладки начинается «Эпизод 1.3. Анна положила...», а видимая страница — «пристани и рассказал...». Якорь точный, но подпись взята с начала пересекающего страницу абзаца; усложняет узнавание позиции.

### Заметка → чтение

Book actions → Notes → No notes yet → Add note → ввод `Continuous native QA note page2` → Done. Список показывает Notes (1), Book note, введённый текст. Back возвращает тот же CFI выше и те же первые 300 символов. Принят общий book-note сценарий, не создание заметки из выделения и не jump по цитате.

### Персонажи и Narra

Reader → Characters у успешно читаемого FBZ показывает `Characters are unavailable for this format` и требует EPUB/FB2/TXT/PDF. [Скриншот](evidence/continuous-product-qa-2026-09-05/12-fbz-characters-unavailable.png). Это format-contract gap: клиент вынужден повторно получать другой формат ради основной функции, хотя FBZ содержит уже извлечённый FB2-текст. Наличие персонажей/их диалога не принято.

Карточка Narra доступна. Открыт чат, отправлен один вопрос `What happened on this page?` с клавиатурой. Реальный gateway вернул 502; UI показывал Typing во время технических повторов. Это не доказательство бесконечного ожидания: конечный retry state в этом шаге не дождались. Back → Characters → Back вернул прежний CFI и текст, чтение доступно. Live качество ответа не принято, массовых AI-вызовов не было.

### URL: зависшая загрузка и отмена

Library → Add book → Add from link → `http://127.0.0.1:8099/stall.epub` → Add. На реальном экране появился Downloading и Cancel. Maestro `assertVisible: Cancel` не нашёл семантический элемент, хотя screenshot кнопку показывает; не объявляется отсутствием видимого управления. Физический tap по видимой кнопке (298,2020 на 1080×2400) убрал загрузку, библиотека и единственная собственная книга остались. Полный URL error/retry и PDF-импорт в этой итерации ещё не приняты.

После перехода обратно в Reader наблюдался прежний asset d2d; для проверки новой реализации Bookmarks согласован отдельный cold restart только приложения (force-stop/start), без перезапуска AVD и без очистки данных.

### Новая реализация Bookmarks: приёмка ещё идёт

Cold restart открыл Library и собственную книгу на прежнем CFI; новый asset `522c0c08177b2126a77e0a64146f8f8c` подтверждён. Меню действительно стало содержать отдельный пункт Bookmarks. Создана новая закладка и физически пройдено две страницы. Однако list/jump/delete нового UI **не приняты**: в ходе параллельных Fast Refresh экран Reader перестал реагировать на меню и системный Back. Read-only navigation показывал только Tabs/Reader (не ReaderTOC), Android input dispatch enabled=true/frozen=false и focused MainActivity, JS inspector отвечал. Это не доказательство дефекта именно Bookmarks: повтор необходим на стабильном cold runtime.

[Состояние экрана](evidence/continuous-product-qa-2026-09-05/21-reader-unresponsive-after-refresh.png), [input state](evidence/continuous-product-qa-2026-09-05/21-reader-input.txt). Файлы `20-bookmarks-list.*` имеют предварительное имя, но фактически содержат Reader, а не открытый список; не использовать их как доказательство списка.

Согласовано окно без изменений runtime для повторного native flow. Дополнительные ошибки инструмента раскрыты: один Maestro запуск из корня вместо packages/app-expo дал `Flow path does not exist`; один ранний next во время закрытия меню не перелистнул и был повторён после завершения перехода. Это не ошибки сохранения страницы.

### Стабильный cold-native gate: Bookmarks PASS с визуальной оговоркой

После финального окна без runtime-изменений: cold NARRA start → Library → My books → собственная книга, asset522c. Сохранённая новая закладка пережила перезапуск. Страница4 → Book actions (дождаться действительно открытого меню) → Bookmarks показывает строку с точным видимым началом «пристани и рассказал о письме...», главой и корзиной. [Фактический список после cold](evidence/continuous-product-qa-2026-09-05/22-bookmarks-actual-list-after-cold.png).

Tap строки (430,1180) вернул **точный** CFI `epubcfi(/6/2!/4/2[chapter-1],/8/1:74,/12/1:286)` и первые 300 символов страницы2. Повторное меню → Bookmarks → корзина (975,1235) удалило только собственную запись. [Пустой список после удаления](evidence/continuous-product-qa-2026-09-05/24-bookmarks-delete-final.png). Read-only SQLite snapshot `/private/tmp/narra-continuous-atomic-final-F5gIle/readany.db`: bookmarks=0, sync_tombstones=2 (до этого1), bookmark_delete_commands=0, таблица существует; завершённая команда очищена. Файл `23-bookmark-list-deleted.png` — промежуточное состояние ДО удаления: первый tap был слишком рано в переходе, повтор после отображения строки успешен.

Таким образом приняты: сохранение → две страницы чтения → cold restart → список → точный переход → удаление из списка → БД. НЕ приняты: injected ошибка SQLite на нативном устройстве, большой список, другая книга/устройство/синхронизация.

Остался P2: Android sheet списка не показывает заголовок Bookmarks и явный Close; root подтвердил formSheet/header ограничение установленного native stack и готовит отдельный UI-fix. Эту визуальную часть gate не объявляет готовой. Наблюдение неответа после HMR осталось в журнале: в стабильном cold запуске Close сработал, реальный menu→Bookmarks открыл ReaderTOC; воспроизводимого cold freeze пока нет. Для будущей автоматизации нельзя нажимать координаты следующего экрана до подтверждения окончания предыдущего перехода.

## Итерация 3: header и FBZ, 15:19–15:24 MSK

После stable signal TTS-агента выполнен один cold restart приложения, без перезапуска эмулятора. Library gate прошёл; собственная книга открылась. Book actions → Bookmarks показал явный заголовок **Bookmarks**, X и исправленную подсказку `Open Book actions (...) while reading, then choose Add bookmark to this page`. [Окончательный screenshot](evidence/continuous-product-qa-2026-09-05/32-bookmarks-final-header.png). Нажатие X (1018,1165) вернуло navigation Tabs/Reader. Визуальный P2 из предыдущего прохода закрыт для Bookmarks. TOC header отдельно ещё не принят. `30-*` и `31-*` — промежуточные изображения меню/перехода, не доказательство header.

Reader → Characters для той же FBZ теперь показывает **Couldn't load characters**, возможность продолжить чтение и Retry; прежнего `unavailable for this format` нет. [Окончательный screenshot](evidence/continuous-product-qa-2026-09-05/34-fbz-characters-final.png). Таким образом снят нативный format-blocker; анализ/генерация всё ещё не приняты из-за gateway502. `33-*` — промежуточный Reader, не доказательство страницы Characters.

### TTS: пока не принят

Добавлен `scripts/qa/android-tts-state-observe.mjs`: read-only наблюдение именно **mobile** TTS store, не одноимённого core store; никакого запуска/останова через inspector. Проверен исходный stopped. После возвращения из Characters несколько физических нажатий на Listen (478,2254) не дали подтверждённого loading: snapshots 15:23:27, 15:23:32, 15:23:46 показывали stopped, пустые bookId/currentText/segmentText. Это **не** успешный Stop: фактическое начало подготовки/загрузки не доказано. Не установлен источник — попадание во время UI-перехода или поведение handler. Для следующего прохода нужны явная preparing UI и подтверждение реального начала запроса, затем отмена; нельзя подменить это direct DOM extraction.

На 15:24 runtime-окно освобождено для следующей согласованной партии исправлений. Звук, отсутствие позднего воспроизведения после настоящей загрузки и external media Stop в этой итерации не приняты.

## Итерация 4: обновлённая native APK и настоящий TTS Start

Согласованная APK SHA256 `2f7711135ebe5f1f03d377ea719f867b082fe0ff5c972a33a0028d08af9db8cf` проверена `aapt`: тот же package/versionCode1/versionName1.3.5, SDK36. Перед обновлением сохранены `readany.db` и `readany_local.db` с WAL/SHM и crash buffer в `/private/tmp/narra-before-native-update-pVpU3R`. До установки: books=1, тот же id911e07fc…, progress0.0621363877731409, CFI страницы2. Выполнен только `adb install -r` → Success; emulator/app data не очищались. Старый APK root сохранил отдельно.

После final Replay stable signal выполнен cold запуск приложения. Library gate PASS, собственная книга сохранилась и открылась на **том же CFI и тексте**, reader asset522c. Это принятая проверка обновления для единственной собственной книги, не миграция всего пользовательского корпуса.

### TTS Start — подтверждён, отмена — ещё нет

Реальный tap Listen привёл к mobile store **loading** в 15:30:19 MSK: currentBookId911e07fc…, totalChunks86, first segment `пристани и рассказал о письме, которое нашёл под фонарём.`, CFI `epubcfi(/6/2!/4/2[chapter-1]/8,/1:74,/1:131)`. Таким образом точка старта проверена уже через клиентскую кнопку, а не только DOM extractor.

Серверный синтез быстро завершается `Speech synthesis stopped after retries`. Второе ручное нажатие спустя около20с было уже новым Start, а не доказанным Stop. Последняя ограниченная попытка: Start →150ms→screenshot→повторный tap того же элемента. [Скриншот](evidence/continuous-product-qa-2026-09-05/41-tts-fast-cancel-before.png) показывает **Preparing text…**. Итоговый store stopped, однако logs вновь показывают остановку после исчерпания повторов; причинный Stop handler не подтверждён. Поэтому отмена и отсутствие позднего аудио **не приняты**. Больше живые запросы в этой итерации не повторялись.

Доказательства: [TTS log от нового запуска](evidence/continuous-product-qa-2026-09-05/42-newapk-tts-log.txt), [итоговое read-only состояние](evidence/continuous-product-qa-2026-09-05/42-newapk-tts-final-state.json), [crash buffer](evidence/continuous-product-qa-2026-09-05/42-newapk-crash-buffer.txt). Последний пуст: новых crash-записей в этом коротком проходе не наблюдалось, но первичный lifetime crash этим не опровергнут. Качество звука/реальное воспроизведение, remote Stop, background recovery и TOC header на новой APK не приняты. Runtime-окно освобождено для controls-timer и global pause/sleep исправлений.

## Итерация 5: явная Cancel и TOC на новой APK

После stable controls/Cancel/Pause batch один cold app start, PID9914. Долгий белый dev-screen завершился сам: Metro running, crash buffer пуст, затем Library Maestro PASS; повторного restart не было. Собственная книга открылась на прежнем page2 CFI и asset522c. Это не измерение release startup latency.

Реальная кнопка Listen показывает [Preparing text… и Cancel](evidence/continuous-product-qa-2026-09-05/44-explicit-cancel-status.png). Файл43 — до появления статуса, не доказательство отмены. Первая ручная попытка опоздала к серверной ошибке; ещё один tap пришёлся на скрытую панель, не стартовал. Эти попытки не засчитаны.

Подтверждённая последовательность: показать controls tap(540,1200) →600ms→ Listen(478,2254) →750ms→ Cancel(540,2085). В log: queue-start15:36:26.853, **TTSStore stop called15:36:27.238**. Read-only store15:36:27.732: explicitCancellationEpoch **0→1**, stopped, totalChunks0, book/text очищены. Повтор15:36:41.611 и15:37:06.283 остаётся stopped/epoch1/empty. [Log](evidence/continuous-product-qa-2026-09-05/45-cancel-log.txt), [late store](evidence/continuous-product-qa-2026-09-05/45-cancel-epoch1-late-state.json), [экран после отмены](evidence/continuous-product-qa-2026-09-05/45-cancel-final.png). Reader CFI и текст страницы не изменились. Принят dispatch явной отмены и отсутствие позднего старта в этом коротком наблюдении; **не** приняты здоровый audio-response→late playback, качество звука, remote Stop и отдельная отмена в подтверждённом loading: быстрый серверный сбой ограничивает их проверку.

TOC: Book actions → Table of Contents показывает [заголовок и X](evidence/continuous-product-qa-2026-09-05/46-toc-native-header.png), три главы, текущая выделена. Tap X(1018,1165) возвращает Reader. Runtime-окно освобождено; живые запросы больше не повторялись. Первый read-only position probe имел adb ENOENT из-за PATH тестировщика; повтор с SDK PATH успешен.

## iOS: независимый bookmark gate после native build36

Устройство iPhone17ProMax iOS26.5, только canonical wrapper. Тестовая книга Аудит08 — АрхивFBZ, id1a1eaa17-e392-4463-a2a2-a80bb58d991f; root подтвердил соответствие backup. Создана собственная закладка72ef4be2-44fc-473d-894b-ee10caac1c78, затем две страницы чтения. Пользовательская книга не открывалась. Первые flow не имели launchApp(stopApp:false); после инициализации Maestro оказывались на SpringBoard. Это ошибка setup теста, исправлена без изменения приложения.

После паузы возобновления screenshot показывал список Bookmarks, но сохранённый accessibility tree failed155803 содержал underlying Reader/Toolbar без sheet. Поэтому assertVisible не доказывает отсутствие списка. Координатное нажатие строки (40%,61%) после launchApp(stopApp:false) вернуло **точный CFI** `epubcfi(/6/4!/4/2[chapter-2],/40/1:37,/46/1:75)`,56.743998681632576%. [Read-only state](evidence/continuous-product-qa-2026-09-05/ios/03-jump-exact-state.json).

Cold app launch через wrapper Maestro(stopApp:true) → Library → Mybooks → подтверждённая карточка08 вернул тот же exactCFI (16:04:29). Jump и cold progress restore приняты. Отдельно остаётся accessibility mismatch sheet; не заявлен доказанный VoiceOver defect без соответствующей проверки.

Следующий delete flow попал в root runtime refresh и увидел Library вместо Reader, FAILED Book actions. Удаление **не выполнено и не принято**; [05-delete-result.png](evidence/continuous-product-qa-2026-09-05/ios/05-delete-result.png) фактически библиотека, а не результат удаления. Запрошено стабильное окно для повтора. Снимок04 также промежуточный, не acceptance удаления.

Повтор в стабильном окне16:06: own08→Book actions→Bookmarks→корзина(89%,62%) удалил единственную собственную закладку. [Настоящий пустой список](evidence/continuous-product-qa-2026-09-05/ios/06-bookmark-deleted.png) показывает No bookmarks yet, правильную подсказку, заголовок и Close. Root выполняет независимую read-only проверку atomicDB; UI deletion принято отдельно от её результата.

Root read-only подтвердил: bookmark72ef4be2… count0, sync_tombstones содержит точный ID/tablebookmarks/deleted_at1788613554918, bookmark_delete_commands count0. Полный собственный bookmark loop принят.

iOS URL error/cancel16:06–16:07: из Library Addbook→Addfromlink→Cancel вернул Library. Запрос localhost8099/missing.epub показал [Couldn't add the book](evidence/continuous-product-qa-2026-09-05/ios/07-url-404.png), исчезший статус не заблокировал следующую попытку. Повреждённый17-truncated.epub показал [Import failed: added0/updated0/skipped0/failed1 + Details](evidence/continuous-product-qa-2026-09-05/ios/08-url-truncated.png); возврат к Library PASS. Details в этом проходе не открывался. Эти два результата не засчитываются как успешный импорт.

Попытка fresh27 по8099/27-fresh-boundary.fbz не является проверкой успешного импорта: URL вернул404, приложение показало Couldn't add the book, rootDBown27 отсутствует. Файл существует локально, но запущенный fixture-server читает allowlist manifest только при старте, маршрут27 в нём отсутствует. Это QA fixture setup error, а не ошибка FBZ parser или сортировки. Поиск несуществующей карточки остановлен; предложен отдельный согласованный loopback fixture server без изменения Metro/старых серверов.

Root нашёл существующий безопасный сервер8089: тот же27-fresh-boundary.fbz HTTP200/2199bytes. Повтор через настоящий UI показал [Done added1/updated0/skipped0/failed0](evidence/continuous-product-qa-2026-09-05/ios/09-own27-added.png). RootDB подтвердил новую запись a1f8291e-7055-4b2d-a887-331b24d31e38,formatfbz. После возврата прокрутки наверх карточка найдена и нажата: [Reader page1/37](evidence/continuous-product-qa-2026-09-05/ios/10-fresh-own27-reading.png), кириллица корректна, read-only16:11:21 exactbookId и CFI `epubcfi(/6/2!/4/2[chapter-1],/2,/8/1:198)`. Fresh URL FBZ→reading PASS.

P2 UI/UX: успешный импорт сохраняет старый scroll offset библиотеки; сообщение Done не предлагает открыть добавленную книгу, новую карточку приходится искать. Evidence09 показывает успех среди старых карточек; сообщено root для отдельной правки. Runtime окно освобождено16:11. Отдельный iOS TTS Cancel/Characters, импорт через Files и mixed multi-select в этом bounded проходе не приняты; Android в этот период не управлялся.

### Исправление single import → Open: mounted regression и native acceptance

По отдельному поручению root изменены import actions/LibraryScreen и RU/EN строка. Использован Expo building-native-ui: существующие toast/action и обычная навигация, без новой дизайн-системы или auto-navigation. Только один действительно новый успешно сохранённый результат без skips/failures получает Open/Открыть на8с; partial failure сохраняет Details, batch/refreshed duplicate не получает Open. Callback связан с конкретной книгой и блокируется после unmount; поздний save после ухода не создаёт toast/navigation.

Три новых mounted regression сначала RED, затем GREEN. Итог54 import-actions tests PASS; full mobile165 suites/1483tests PASS; TypeScript и targeted diff-check PASS. Дополнительные проверки: EN локализация, первая toastaction не открывает книгу из последующего импорта, отсутствие действия при batch/refresh/partial failures и после unmount.

После root review создан новый собственный fixture28-open-after-import.fbz эксклюзивной записью без изменения старых файлов;8089HTTP200/2203bytes. Реальный iOS flow: Addfromlink→URL→[Done added1 с Open](evidence/continuous-product-qa-2026-09-05/ios/11-fresh-import-open-cta.png)→tap Open→[Reader](evidence/continuous-product-qa-2026-09-05/ios/12-fresh-import-open-reader.png). Inspector16:15:27 bookId050aa424-1771-461f-9e19-d45f72dca5d4, CFI `epubcfi(/6/2!/4/2[chapter-1],/2,/8/1:198)`. iOS single URL import→explicit Open PASS. Android CTA, локальный Files CTA, batch на устройстве и полная доступность VoiceOver не проверены этим изменением. Окно освобождено.

Root независимо просмотрел iOS screenshot11 и подтвердил DB: id050aa424… соответствует Аудит28,formatfbz, CFI совпал. Собственный fullmobile root165/1483PASS. iOS fix принят.

### Android native acceptance того же Open

Без reinstall/wipe/app или emulator restart: ADBdevice5554, прежнийPID9914, Metro running. До импорта read-only DB snapshot `/private/tmp/narra-android-open-baseline-8gMisC`: единственная own27/id911e07fc…,progress0.0621363877731409. Добавлен только adb reverse8089 к существующему loopback fixture server.

Первая fresh28 импортировалась, но MaestroFAILED Open visible: медленный semantic polling пропустил toast, это не принято как Open success. Для одного дополнительного физического прохода создан отдельный own29 fixture (exclusive write). При вводе ADB первый слишком ранний ввод потерял/не дописал часть URL; он исправлен на экране ДО отправки, не product import failure.

На корректныйURL8089/29-open-after-import.fbz: реальный Add →1.2с→[Done и Open](evidence/continuous-product-qa-2026-09-05/47-android-open-cta.png)→tapOpen(282,2017)→[Reader](evidence/continuous-product-qa-2026-09-05/48-android-open-reader.png). Navigation16:19:50 exactid828da4e8-c559-4261-b010-1bc0ef27a5bc. Read-only DB `/private/tmp/narra-android-open-confirmed-liEEZG` подтверждает Аудит29 иprogress0.0310681938865705; own27progress неизменен, own28 сохраненаprogress0. Readerasset522c, CFI `epubcfi(/6/2!/4/2[chapter-1],/2,/8/1:74)`, русскийтекст корректен. Android freshURL→explicitOpen PASS. Первый DBexport упёрся в default1MB buffer WAL, повтор с16MB успешен; это ограничение тестового инструмента, БД не изменялась. iOS в этом проходе не управлялся. Окно освобождено.
