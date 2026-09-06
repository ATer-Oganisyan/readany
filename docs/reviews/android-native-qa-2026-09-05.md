# Android: нативная приёмка, 2026-09-05

Рабочая база: `mishanaer/Narra`, `8d9d6bb` с текущими локальными исправлениями.
Устройство: `Readest_API_36_arm64`, `emulator-5554`, Android API 36, arm64.
Приложение: `com.mishanaer.readany.dev`, debug dev-client; это не подписанный
release-артефакт для Google Play. Metro и сервер собственных книг доступны
через локальный `adb reverse` портов 8081/8099. Пользовательские данные не очищались.

## Воспроизведённый блокирующий дефект запуска

Первая APK успешно скомпилировалась и установилась, но приложение вместо
библиотеки показало `NoClassDefFoundError: expo.modules.kotlin.types.AnyTypeProvider`
в `DomWebViewModule.definition`. Простой `am start` с `Status: ok` ошибочно
считался бы успехом без проверки экрана.

Причина проверена по фактическим файлам: manifest/lockfile требовали
`@expo/dom-webview@57.0.1`, но установленный пакет был `55.0.6` при
`expo@57.0.14` и `expo-modules-core@57.0.11`. Версии зависимостей проекта
не менялись: выполнен `CI=1 pnpm install --frozen-lockfile`, затем Android
incremental rebuild, `BUILD SUCCESSFUL in 29s` и установка обновлённой APK.
После этого открыт реальный экран Library. Аналогичный класс несовместимости
описан в [Expo issue #47661](https://github.com/expo/expo/issues/47661).

Защита от повтора: `scripts/check-installed-dependencies.mjs` проверяет реальные
версии pinned-зависимостей и поддерживаемые диапазоны установленного Expo.
Три поведенческих теста: stale/missing package, закрытый exports package.json,
диапазоны Expo с явными исключениями. Все прошли; TypeScript прошёл.

Доказательства:

- `/private/tmp/narra-audit-android-library.png` — исходная ошибка native startup.
- `/private/tmp/narra-audit-pnpm-install.log` — синхронизация установленного дерева.
- `/private/tmp/narra-audit-android-rebuild-dom.log` — успешная исправленная сборка.
- `/private/tmp/narra-audit-android-empty-library.png` — пустая библиотека после исправления.

## Матрица (обновляется по реально выполненным действиям)

| Сценарий | Статус | Наблюдение |
| --- | --- | --- |
| Native startup / Library | Прошло после исправления | Исходный runtime crash устранён; Library/My books доступны |
| Пустая библиотека → Add → Choose file | Прошло | Открывается системный Android picker |
| Popular / серверный каталог | Не прошло: внешняя зависимость | На момент проверки test gateway отвечает 502; каталог показывает ошибку и Retry |
| Несколько собственных файлов | Прошло сохранение данных | 19 выбранных через picker: 12 уникальных книг, 1 повтор тех же байтов без новой строки, 6 повреждённых отклонены; phantom-книг нет |
| Текстовые форматы / кодировки | Прошло 10/10 | EPUB, uppercase/кириллица/% EPUB, FB2 UTF-8/CP1251, TXT UTF-8/UTF-16/CP1251, FBZ, вложенный FB2.ZIP, UMD: читаемый body, 10 тапов, возврат Library |
| Genuine MOBI / AZW3 / AZW | Прошло 3/3 | Оригиналы созданы Calibre: настоящие MOBI6/KF8; читаемая кириллица, по 10 тапов, возврат Library |
| CBZ: чтение / TOC / возврат | Прошло после исправлений | Изображения 595×842 видимы; 3 next, prev, center-controls, выбор 2-й страницы в TOC, Back/reopen точно /6/4 |
| PDF: отображение / выделение / cold resume | Прошло после исправлений | 12 страниц; после coldstart тот же /6/6, Page 3. Слои совпадают, текст не дублируется, native longpress выделяет реальное слово |
| Повторный смешанный импорт | Прошло сохранение данных и счётчики | 24 входа: 17→18 книг, прежние id/fileHash/contentHash/currentCfi/progress неизменны. Следующий повтор: Added 0 / updated 18 / skipped 0 / failed 6, новых строк нет |
| URL: native prompt / 404 / truncated / Cancel | Прошло в перечисленных сценариях | Add и Cancel работают; повреждённый EPUB и 404 не добавляют phantom-книг; активная отмена stall освобождает следующий импорт |
| Ошибки импорта → Details | Прошло 3/3 строгих повтора | Screenshot/OCR → физическое нажатие → реальный Alert с именем файла и понятной причиной; дополнительный gesture patch не потребовался |
| EPUB: частичная загрузка | Прошло на установленном asset | Большая книга 1 719 918 байт: 12 реальных HTTP 206, 74 023 байта ranges в окне наблюдения, прежний CFI |
| Чтение при недоступной генерации | Прошло 10 переходов и возврат | Новый asset: 10/10 новых CFI, ни одной idle вставки в 12 snapshots; Back/reopen сохраняет точные CFI и 300 символов |
| URL: redirect / новая редакция | Данные прошли | Redirect сохраняет одну запись и CFI; новая редакция добавлена отдельно, 16→17; прежние 16 id/hash/CFI/progress не меняются. Общий счётчик исправлен; native URL-error показывает Added/Updated |
| Листание длинного TXT | Прошло: 20 переходов | 20 физических тапов → 20 новых CFI, книга 1139 расчётных страниц; главы отдельно не приняты |
| Точный прогресс после kill | Прошло после исправления | Физический tap → 700 мс → force-stop → cold start: совпали CFI и 300 символов видимого фрагмента |
| Fresh FBZ: TOC 3 → 1 → граница глав | Прошло после P1 исправления | BEFORE пропускал главу 2; AFTER: 12 next идут 1→2, 12 prev — 2→1, 12 быстрых next — 1→2, с точными конечными CFI/текстом |
| Персонажи / чат / возврат | Прошло восстановление после ошибки; live AI заблокирован сервером | Финальный Reader→Characters→Narra→Send с клавиатурой→Back сохраняет CFI и текст; live gateway 502 не позволяет принять качество ответа/сцен |
| Пропавший локальный CBZ | Прошло через Library | Prompt → Re-import → системный picker → COW-файл с тем же hash/id; ровно p.2 of4, CFI /6/4 |
| Заметки выбранной книги | Прошло на финальном Notes JS | Empty CTA → первая запись; header Add → вторая; inline Edit обновляет прежний id; SQLite содержит ровно 2 правильные записи этой книги; другая книга остаётся пустой; возврат сохраняет CFI/текст |
| PDF: меню выделения → заметка → возврат | Прошло после исправлений | Native Add note сохраняет diary /6/6; 3 перехода page3→4→Notes→3 сохраняют один Reader key, stack Tabs/Reader; Close сразу Library. Отдельные неудачные Maestro center taps раскрыты ниже |
| Тема / подписи / системные иконки | Прошло на d90 + финальном RN JS | Dark labels читаемы; Light Notes clock contrast 1,09→5,59; Dark control 18,88. Dark→System без cold возвращает native adaptive/light и светлые Notes/Profile/Library |

Тестовые файлы находятся в `/sdcard/Download/NarraAudit`. Файлы, загруженные
через adb, не появляются в индексируемом Downloads-provider этого эмулятора;
доступ проверяется через системный корень внутреннего хранилища → Download.
Это особенность подготовки fixture, не подтверждённый дефект NARRA.
Плавающая кнопка Expo Tools в debug-клиенте перекрывала кнопку Add в шапке;
её передвинули обычным жестом. Она не относится к release UI.

Открытые строки не считаются принятыми. Полная готовность Android к массовому
релизу пока не подтверждена.

## Дополнительные воспроизведения и измерения

- CBZ был недоступен в Android picker: `content gettype` вернул
  `application/x-cbz`, которого не было в MIME-фильтре. Добавлен alias; тест
  «picker → import» сначала падал, после исправления прошёл. Повтор через
  настоящий picker успешно добавил `12-river-comic.cbz` как 13-ю книгу.
- Само открытие CBZ отдельно выявило пустые страницы fixed-layout при событии
  `reader_loaded`. Этот дефект передан на независимое исправление. Успешный
  импорт CBZ **не** засчитан как успешное чтение.
- Пакетный импорт: первый файл начал обработку `00:32:33.492`, последний
  повреждённый UMD отклонён `00:32:54.557` — около 21,1 секунды на 19 входов.
  TXT 1 684 203 байта конвертирован примерно за 1,48 секунды.
- В длинном TXT первое изменение CFI после 20 отдельных тапов занимало
  103–354 мс, включая задержку управляющей команды. Это время **первого события
  позиции**, не гарантированное время окончания анимации. Физическое устройство
  не измерялось; эмулятор работал параллельно с iOS-сборкой.
- Прямой до/после baseline скорости отсутствует, процент ускорения не выводится.

Ключевые снимки сохранены в репозитории:

- [Ошибка запуска](evidence/android-2026-09-05/startup-error.png).
- [Пустая библиотека после исправления](evidence/android-2026-09-05/library-empty.png).
- [Библиотека после смешанного импорта](evidence/android-2026-09-05/mixed-import-library.png).
- [Пустой CBZ до исправления](evidence/android-2026-09-05/cbz-blank-before.png).
- [Читаемый CP1251 FB2](evidence/android-2026-09-05/fb2-cp1251-text.png).
- [Та же страница после hard-kill](evidence/android-2026-09-05/progress-after-hard-kill.png).
- [URL-поле до исправления](evidence/android-2026-09-05/url-input-before.png).
- [URL-поле после исправления, с клавиатурой](evidence/android-2026-09-05/url-input-after.png).

## Повторяемый прогон текстовых форматов

`.maestro/android-imported-format-reading.yaml`, Android AVD, завершён с кодом 0:
10 из 10 книг, 100 физических page-tap действий, по два снимка на каждую книгу
(начало и после десяти тапов), после каждой книги подтверждён экран Library.
В каждом чтении проверен доступный текст с «Анна», а не один `reader_loaded`.
Все десять имеют ненулевую сохранённую позицию. Сырые артефакты:
`~/.maestro/tests/2026-09-05_005033`, журнал
`/private/tmp/narra-audit-android-formats-maestro-stable.log`.

Это мини-цикл чтения, **не** утверждение, что оглавление, live AI и hard-kill
отдельно пройдены для каждого формата. Предыдущий исследовательский прогон
прервался во время третьей книги из-за подтверждённого React Native dev reload
в 00:48:16; после отключения Fast Refresh повтор завершился. Такой перезапуск
режима разработки не записан как дефект формата.

Целевой повтор тестов Android-исправлений: `installed-dependencies`,
`library-import`, `import-actions` — **43/43**, без пропусков. Новый read-only
CDP/native-tap probe `scripts/qa/android-reader-position.mjs` фиксирует CFI,
видимый фрагмент и размеры загруженных изображений; он не подменяет состояние
приложения через DOM. Форматирование и проверка новых скриптов прошли.

## Сохранение последней страницы: реальный до/после

Одна и та же большая книга, одна и та же страница: до исправления после
перехода на `epubcfi(/6/2!/4,/110,/114/1:251)` и force-stop спустя 700 мс
сохранялась предыдущая позиция `/104/1:113,/108/1:349`.
После page-checkpoint + исправления CFI restore эта новая позиция оказалась
в durable JSON с `pending: true`, а после холодного запуска восстановились
**точно тот же CFI и тот же 300-символьный текст**, начинающийся с «Эпизод 1.51».
Это выполненный Android native повтор, а не имитация перезапуска в unit-тесте.

Техническая граница: snapshot coalescing занимает 500 мс. Данный прогон
подтверждает окно 700 мс после page event; уничтожение процесса до окончания
этого окна или аппаратный обрыв питания не объявляются проверенными.
Обычный уход в фон дополнительно вызывает немедленный flush.

## Повторный импорт и настоящие Kindle

Второй выбор через настоящий системный picker: 23 поддерживаемых входа,
включая прежние корректные/повреждённые файлы и три новых оригинала Calibre.
Библиотека выросла с 13 до 16 книг; добавились только MOBI, AZW3 и AZW.
Сравнение сохранённого JSON до/после: **ни у одной из 13 прежних книг не
изменились id, CFI и прогресс**. Повторная обработка FBZ извлекла правильные
метаданные; существующие карточки с тем же hash намеренно не заменены.

`.maestro/android-kindle-reading.yaml` завершён с кодом 0: 3/3 книги,
проверка реальной кириллицы («Анна»), по десять действий листания и возврат
в Library. Вместе с предыдущей матрицей: 13 форматно-кодировочных вариантов,
130 действий page-tap. Это не проверка каждого возможного экземпляра формата.
Артефакты: `~/.maestro/tests/2026-09-05_012156`,
`/private/tmp/narra-audit-android-kindle-reading.log`,
`/private/tmp/narra-audit-android-before-kindle-batch.json`,
`/private/tmp/narra-audit-android-after-kindle-batch.json`.

## Android URL-ввод: нативный до/после

На настоящем Android EditText строка URL пересекала нижнюю линию поля.
Измерение UIAutomator при 420 dpi: высота **73 px / 27,81 dp**. В модуле
native-controls padding заменён на dp, добавлены минимальные 48 dp и вертикальное
центрирование; существующие кнопки, цвета и тип диалога сохранены. После
локальной Android rebuild (11 секунд, без изменения зависимостей) поле имеет
**127 px / 48,38 dp**, текст виден целиком, клавиатура и обе кнопки доступны.

`scripts/qa/android-url-prompt-layout.mjs` проверяет действительное дерево
нативного UI, а не текст Kotlin: до исправления RED, после GREEN. На свежем
бинарнике отдельно выполнены Cancel → Library и Add → HTTP 404.
Снимок после визуальной стабилизации сохранён рядом с исходным.

Повреждённый URL EPUB показал Import failed и Details без phantom-книги.
Один зависший ответ завершился сетевой ошибкой примерно через 60 секунд;
другой был отменён пользователем, после чего можно снова открыть Book link.
Точный benchmark времени активной отмены не проводился. Короткие toast не
всегда ловятся Maestro из-за задержки драйвера и анимации; отсутствие снимка
toast не записывается автоматически как дефект продукта.

## CBZ: финальные нативные переходы

После исправлений fixed-layout и координат вложенного iframe:
три правых физических тапа дали CFI `/6/2 → /6/4 → /6/6 → /6/8`;
левый тап вернул `/6/6`. Во всех активных страницах реально загружены PNG
595×842. Центр открыл controls, Appearance — штатные настройки.
Table of Contents показал все четыре изображения; выбор `river-02.png`
перевёл на `/6/4`. После Back → Library → повторного открытия восстановились
тот же `/6/4` и `river-02.png`, без пустой страницы.

Отдельно обнаружен неверный пользовательский счётчик: при последней из
четырёх страниц header показывал `p.185 of247`. Передан в исправление;
правильная CFI-навигация не означает, что этот UI-дефект уже принят.
Сырые JSONL: `/private/tmp/narra-audit-android-cbz-final-next.jsonl`,
`...-prev.jsonl`, `...-reopened.jsonl`. Ключевой снимок:
[CBZ после исправлений](evidence/android-2026-09-05/cbz-after-fix.png).

После длинного debug-сеанса Android process имел PSS около 1 GiB с большим
SwapPSS; одновременно работали iOS Simulator и локальная сборка контейнера.
Это не чистый performance baseline и не доказательство утечки. Нужен отдельный
ограниченный memory soak и проверка подписанного release на физических устройствах.

Контроль после холодного запуска и открытия только одного PDF: Native Heap
около 652 MB против 736 MB после длинного сеанса. Большая часть памяти уже
занята свежим debug runtime; одного сравнения недостаточно для вывода об утечке.

Новая естественная раскладка inline-сцен проверена именно Android WebView:
три изолированных геометрических случая дали `passed: true`, без пересечения
текста и квадрата. При четырёх строках квадрат находится на той же странице,
`x=0, y=120, height=320`; до исправления принудительно уходил в следующую
колонку, `x=340, y=0`. Это проверка production CSS в настоящем движке, но
не успешная live AI генерация — сервер в это время недоступен.

## URL: новая редакция, отмена и подробности

`redirect.epub` действительно прошёл 302 на исходный EPUB с тем же SHA256:
новая строка не появилась, исходная позиция сохранена. Однако текущая реализация
обновляет существующую запись и сообщает `Imported: 1`; это отдельный
подтверждённый дефект счётчика, а не дубликат данных. Исправление Added/Updated
сохраняет полезную семантику повторного импорта.

`changed-edition/01-river.epub` добавил отдельную «Аудит14 — Новая редакция реки»
с hash `8f53e9d03156f474be03954c267ee004f22915655ecea5ae67f5dbd86c4e8ec1`.
Старые16 книг не поменяли id/hash/CFI/progress. Исходный01 EPUB по-прежнему
имеет SHA256 `ddca1e91eea8506e18bc5dfa322a8a0b02abad119cfc957a1528d12466994add`.

Зависшая загрузка теперь располагается [над нижними вкладками](evidence/android-2026-09-05/url-loading-bottom.png),
не перекрывает Library/Add/Popular/My books. Во время неё выполнены четыре
жеста прокрутки библиотеки. После Cancel и700 мс ожидания (855 мс с управляющей
командой) снимок уже не содержит toast; следующий native prompt открыт.

Повреждённый EPUB показал [полные счётчики0/0/1](evidence/android-2026-09-05/import-error-summary.png).
Реальное нажатие Details открыло [имя файла и понятную причину](evidence/android-2026-09-05/import-error-details.png),
без технического пути/HTML, с рабочей кнопкой Close. Обнаружено также зависание
старого toast после Details под следующим результатом; root проверяет таймер
жеста, этот нюанс пока не объявлен исправленным.

## P1: лишние обновления скрытых экранов

Цепочка: URL новой редакции → открытие → читаемый текст → page tap → controls
→ Characters. После нажатия экран оставался Reader более30 секунд, RN JS thread
держал85–93% CPU. Это не засчитано как успешный core loop. Во время диагностики
Characters всё же появился с правильными английским текстом и Retry.

Снят5-секундный профиль настоящего Android Hermes через штатный локальный
инспектор (`Tracing.start/end`, не подмена JS-состояния). Окно5,117 секунды:
157 native commit starts,1347 TouchableOpacity render starts,1321 View,
4 MiniHeatmap. Scheduler зафиксировал4 обновления **скрытого ProfileScreen**:
`updateActiveTime → Zustand setState → forceStoreRerender → ProfileScreen`.
ReaderContent также обновлялся от таймера сессии. Это подтверждённая лишняя
нагрузка, но не доказательство бесконечного цикла; причинный native A/B ещё нужен.

- [Сжатый исходный trace](evidence/android-2026-09-05/characters-cpu-before.json.gz).
- [Стековый summary](evidence/android-2026-09-05/characters-cpu-before.txt).
- [Состояние недоступности AI с Retry](evidence/android-2026-09-05/characters-after-retry-fix.png).

В этом состоянии `dumpsys meminfo`: PSS1,17GB, RSS776MB, Native Heap allocated
748MB,917 native Views,2 WebViews; оба WebView уже detached после перехода.
Профилирование само добавляет overhead, поэтому эти числа не объявляются
release performance. Повторяемый сборщик: `scripts/qa/android-hermes-profile.mjs`.

### A/B после только focus-aware ProfileScreen

Другие CPU-исправления Reader и установка Sonner удерживались до окончания
этого замера. После cold reload открыта та же новая редакция, та же CFI.
Второй trace длился5,074 секунды и включал физическое нажатие Characters:

| Диагностический показатель | До | После |
| --- | ---: | ---: |
| Scheduler events `Update` скрытого ProfileScreen | 4 | 0 |
| MiniHeatmap render starts | 4 | 0 |
| Native commit starts во всём окне | 157 | 21 |
| View render starts во всём окне | 1321 | 354 |

CharacterChatList смонтирован на3,653 секунды записи; его экран с Retry
визуально подтверждён после записи. Первый снимок через1954мс от начала
команды tap ещё показывал Reader, поэтому «мгновенный переход» не заявляется.
Короткие trace-окна различаются переходом/состоянием процесса; это подтверждение
устранения лишнего hidden rendering, не чистый release benchmark ускорения.
После Back совпали прежние CFI `/6/2!/4,/8/1:147,/12/1:357` и видимый текст.

[Исходный after trace](evidence/android-2026-09-05/characters-cpu-profile-only-after.json.gz).
В исходном trace дополнительно есть один `Update Blocked` для ProfileScreen;
он не включён в четыре события с точным именем `Update` в таблице.
На этапе Profile-only ReaderContent ещё был подписан на секундные изменения
сессии. Отдельный фикс и финальный native повтор описаны ниже.

## PDF и нативный сетевой deadline: дополнительный AFTER

После холодной загрузки PDF-исправления повторно открыт Page 3 с прежним CFI.
Видимое дублирование исчезло; прозрачность spans теперь `rgba(0,0,0,0)`,
прямоугольники textLayer и canvas совпадают: 412,19×583,24 CSS px.
Но видимый span всё ещё имеет `font-size: 16px`, ширину строки около 27 px
и высоту 1,22 px: выделение текста пока не принято. Скрытый frame имеет
ожидаемые 160,027 px, что указывает на позднее применение reader-стилей.
[Промежуточная геометрия](evidence/android-2026-09-05/pdf-text-intermediate.json)
сохранена; дополнительное исправление передано владельцу PDF.

Bounded script `scripts/qa/android-native-download-check.mjs --platform=android`
вызывает настоящий ExpoPlatformService через Android Hermes и создаёт только
новые собственные файлы cache. Первый AFTER показал:

- stall: запрос прекратился за 1089 мс при deadline 1000 мс, но вернул
  `AbortError`, а не `TimeoutError` — классификация ошибки ещё исправляется;
- повтор: 4054 байта EPUB с ZIP-сигнатурой, 35 мс;
- заранее отменённый signal: `AbortError`, 0 мс, файл не создан;
- поздних progress callbacks нет; все три QA cache-пути очищены.

[Исходный результат](evidence/android-2026-09-05/native-download-reason-before.json).
Это функциональная проверка нативного транспорта через localhost, не тест
пользовательского WebDAV-сервера и не release benchmark сети.

### Финальный AFTER PDF и транспорта

После следующего исправления видимый PDF span имеет `160,027px`, ширина строки
253,36 px и высота 7,62 px, canvas/textLayer по-прежнему точно совпадают.
Чужой `reader_overrides` stylesheet в PDF отсутствует. Настоящий Android
longpress выделил слово `diary` ровно поверх печатного слова, с нативными
ручками выделения; прежний CFI `/6/6` сохранён.
[Геометрия](evidence/android-2026-09-05/pdf-text-after.json),
[выделение](evidence/android-2026-09-05/pdf-selection-after.png),
[прочитанный DOM selection](evidence/android-2026-09-05/pdf-selection-after.json).

Финальный native download script завершён с `functionalPassed: true`,
`timingPassed: true`, `cleaned: true`. Теперь stall даёт **TimeoutError**
за 1779 мс при deadline 1000 мс; retry скачал 4054 байта за 4731 мс;
precancel — AbortError за 1 мс, без файла. Одновременно выполнялся Maestro
PDF open, поэтому эти задержки не используются для оценки скорости сети.
[Результат](evidence/android-2026-09-05/native-download-after.json).

### Смешанные 24 входа и честный повтор

Новый проход выбрал 24 файла: 17→18 уникальных книг, добавлен только наш
`26-mixed-recovery.txt`. Сравнены настоящие поля `id`, `fileHash`, `contentHash`,
`currentCfi`, `progress` всех 17 прежних записей — изменений нет.
Следующий повтор тех же входов дал [видимые счётчики](evidence/android-2026-09-05/mixed-import-counts-after.png):
Added 0 / updated 18 / skipped 0 / failed 6; заголовок не обещает новых книг.
18 обновлений — это обработанные успешные входы, включая renamed same-hash,
а не прирост числа карточек. Уведомление показано около 16-й секунды native
записи и исчезло примерно на 25-й; захват начался до нажатия Select.
Системный picker копировал выбранные файлы около первых четырёх секунд.

Maestro-assert Details в предыдущем проходе завершился timeout; это не принято
как доказательство поломки уведомления: отдельная непрерывная native запись
подтвердила его реальные текст и длительность.

Один последующий point-tap по Details не показал Alert; это было основанием
для расследования, но не доказательством причины в библиотеке жестов.
Три новых одинаковых прохода с OCR фактического screenshot → немедленным
физическим tap в центр видимого текста **все открыли настоящий Alert**.
Текущий RN Pressable не менялся. Предложенный дополнительный patch отменён:
прежний результат остаётся timing/intermittent наблюдением, а не доказанным P1.
UIAutomator не используется для поиска краткоживущей кнопки, поскольку его
ожидание idle может пережить само уведомление. OCR работает локально через
системный Vision, не изменяет приложение и не продлевает время уведомления.
[Видимая кнопка](evidence/android-2026-09-05/import-details-visible.png),
[реальный Alert](evidence/android-2026-09-05/import-details-alert.png),
[координаты и времена native действий](evidence/android-2026-09-05/import-details-native-actions.jsonl).
Между вторым и третьим повтором выполнена реальная отмена `stall.epub`:
уведомление исчезло, следующий импорт стартовал и показал ожидаемую ошибку
повреждённого файла. [После отмены](evidence/android-2026-09-05/import-cancel-after.png),
[native действия](evidence/android-2026-09-05/import-cancel-native-actions.jsonl),
[повтор 2](evidence/android-2026-09-05/import-details-repeat2.jsonl),
[повтор 3](evidence/android-2026-09-05/import-details-repeat3.jsonl).

## Восстановление отсутствующего CBZ

Временно перемещён только наш исходный CBZ после проверки SHA256.
Нативная цепочка Library → Book file missing → Re-import → Android picker
успешно разрешила выбрать `.cbz`, который раньше не входил в MIME-фильтр.
Восстановление создало новый copy-on-write файл с тем же SHA256
`6b40ade28fceeb3541151c47e90074ae119d18dde26772248f1909884c213a8c`.
ID и progress прежние; CFI `epubcfi(/6/4)`, видимая страница **2 из 4**.
Своя временная backup-копия удалена после сверки нового файла; оригинал fixture
сохранился. Пользовательские файлы не затронуты.

`.maestro/android-repair-cbz.yaml` завершён с кодом 0.
[Восстановленная та же страница](evidence/android-2026-09-05/cbz-repaired-same-page.png).
Отдельные входы восстановления из Notes/Profile пока не проверены нативно.

## Финальный переход Reader → Characters → чат → Reader

После обоих исправлений подписок выполнен переход к Characters с экраном
ошибки и Retry, затем Narra: показана английская клавиатура, введён и отправлен
наш вопрос про Анну. Видны собственный bubble и локализованное `Typing…`,
нет ложного idle-online. Back из чата с активной клавиатурой → Back из
Characters вернул чтение с точными прежними CFI и 300 символами фрагмента.
Запрос к live gateway не считается успешным AI ответом.
[Клавиатура и ввод](evidence/android-2026-09-05/chat-keyboard-after.png),
[доступный экран Characters](evidence/android-2026-09-05/characters-transition-after.png).

В финальном переходном trace 5,021 секунды скрытые Profile/MiniHeatmap не
обновлялись; два ReaderContent scheduler-события относятся к окну перехода,
не объявляются повторяющимся секундным циклом. Первый CharacterChatList
начал render на 2,576 секунды записи; tap отправлен примерно после первой
секунды. Это не точное frame-to-frame время и не release performance benchmark.
Отдельное idle-окно 5 секунд содержит одно Reader scheduler-событие, без
Profile/MiniHeatmap; принудительный GC не выполнялся.
[Переходный trace](evidence/android-2026-09-05/characters-cpu-final.json.gz),
[idle trace](evidence/android-2026-09-05/reader-idle-final.json.gz).

## Пять циклов небольшой книги: память

После прогрева собственного `26-mixed-recovery.txt` (1105 байт, импортирован
как EPUB) выполнены пять отдельных нативных циклов: открыть → проверить
«Анна» в body → Back → Library. Все пять завершились с кодом 0, тот же PID,
CFI и progress сохранены. Скрипт: `scripts/qa/android-small-book-soak.mjs`.

| Показатель debug process | До | После 5 циклов | Наблюдение |
| --- | ---: | ---: | --- |
| TOTAL PSS, KB | 1006871 | 1006962 | Практически тот же объём |
| Native Heap allocated, KB | 698800 | 720328 | Промежуточно снижался на 3-м цикле до 704080 |
| Native Views | 964 | 964 | На 3-м цикле 901 |
| WebViews | 2 | 2 | На 3-м цикле 1; накопления не видно |

[Все исходные замеры и результаты циклов](evidence/android-2026-09-05/small-book-memory-soak.jsonl).
В эмуляторе много SwapPSS, поэтому падение RSS не объявляется освобождением
всей памяти. Принудительный GC и heap-retainer анализ не выполнялись;
устойчивая утечка этими пятью циклами не воспроизведена. Большой абсолютный
debug footprint остаётся риском для проверки release на реальных телефонах.

## Установленный EPUB: частичная загрузка и точный контекст

После полного перезапуска Android загрузил reader asset с MD5
`7bc621c3cf02cc216d4ae01a195e7721` (общий ZIP/context фикс). До нажатия на
карточку большой собственной книги включено read-only наблюдение CDP Network.
Книга 1 719 918 байт, 28 разделов открылась с прежним CFI. Записаны 12 реальных
ответов HTTP 206 с корректными Content-Range, суммарно 74 023 байта в данном
окне наблюдения. Ошибка прежнего lazy path и full-fetch fallback не
наблюдались. Это не оценка всего трафика за сессию и не измерение release-скорости.
[Сетевые ответы установленного reader](evidence/android-2026-09-05/epub-lazy-installed-after.json).

Вызван экспортированный `window.getVisibleReadingContext` именно установленного
asset: CFI до/после и roundtrip совпадают; содержательные символы совпадают
с восстановленным диапазоном. Отличие от сырого `Range.toString` — ожидаемые
пробелы между соседними абзацами. Ранее отдельный native DOM probe воспроизвёл
смещение live Range при маркировке имён и подтвердил исправление через свежий
CFI; этот изолированный probe не подменяет реальный установленный путь.
[Контекст установленного reader](evidence/android-2026-09-05/context-installed-after.json).

## Недоступная генерация не вставляет пустые страницы

Финальный reader asset `c11f24dcfc898489d8c0699a6729403b84e55826c6c0512c2710f784e224c03e`
проверен после cold reload (фактический asset MD5
`ebc454daf48943c10a445fdb13ea6ec2`). Большая собственная книга не имеет готовой
backend-привязки; генерация недоступна. Десять физических next-tap дали десять
новых CFI; в initial, десяти переходных и settled снимках DOM нет scene inserts.
Читаемый экран заполнен текстом, без пустой страницы-приглашения к неработающей
генерации. Back → Library → повторное открытие сохранило точные CFI и первые
300 символов фрагмента.

[Десять переходов](evidence/android-2026-09-05/scenes-disabled-turns.jsonl),
[реальный экран](evidence/android-2026-09-05/scenes-disabled-reader.png),
[повторное открытие](evidence/android-2026-09-05/scenes-disabled-reopen.jsonl).
Сохранённых изображений сцен у этих Android fixture-книг нет; их сохранность
на Android этим проходом не проверена. Генерация живого AI по-прежнему не
принята. Последний код изменяет доступность placeholders; ранее принятые
ZIP/PDF/context сценарии выполнены на указанном в своих разделах предыдущем
asset, а не автоматически объявляются повторно пройденными на новом.

Финальная проверка английской accessibility-разметки Library после cold reload
также прошла: группа называется `Library section`, соседние controls —
`Popular` / `My books`, без прежней русской fallback-подписи.
[Нативная иерархия](evidence/android-2026-09-05/library-en-accessibility.jsonl).
Приложение оставлено на Library; активных UI-драйверов и профилирований нет.

## Исправленный P1: пропуск целой главы после оглавления

Независимо повторён iOS дефект на Android со свежей собственной FBZ:
`27-fresh-boundary.fbz`, внутренний заголовок «Аудит 27 - Граница глав»,
SHA256 `e8c0288c81ed16c26ac22affc8ab02b95a22cd8ab5481ed626caf95a77cf79f8`.
Системный Android picker импортировал её отдельной 19-й записью с правильным
внутренним названием, без CFI до первого открытия. Старые книги не удалялись.
Fixture после импорта перемещена в `Download/NarraAuditFresh`, чтобы не менять
исходный 24-input набор смешанного импорта.

На asset `c11f24dc…` переход TOC → глава3 → TOC → глава1 оставляет frames `[0,2]`.
Десятый next ещё показывает главу1 /6/2 и эпизод1.27; одиннадцатый сразу
показывает главу3 /6/6 и эпизод3.1. Между каждым физическим tap выдержана
секунда и повторно считаны CFI/текст; это не краткий анимационный кадр.
Старая уже читанная FBZ с frames `[0,1,2]` правильно открывает главу2 на tap11,
поэтому без свежего экземпляра ошибка скрывалась бы прогретым кешем.

[Строгое воспроизведение](evidence/android-2026-09-05/chapter-skip-before.jsonl),
[warm-cache контроль](evidence/android-2026-09-05/chapter-skip-warm-control.jsonl),
[реальный экран пропущенной главы](evidence/android-2026-09-05/chapter-skip-before.png).
На исправленном asset SHA256
`9667fc81cc85c995ac9a3094f33f895d27b8a68a7babc86addc2e6ddb7c30d76`
(фактический MD5 `1c33dccc56fb59327fce61a449d4cea6`) после cold reload той же
книги и повторного TOC3→1 остаётся корректный непрерывный набор frames `[0]`.
Двенадцать next с секундной паузой проходят 1→2, tap11 показывает главу2.
Двенадцать prev проходят 2→1 и возвращают исходные CFI/300 символов.
Ещё двенадцать next без добавленной межтапной паузы заканчиваются на точно
тех же CFI/тексте, что и медленный проход. Быстрый драйвер ждёт первого CFI
после каждого tap: это не испытание неограниченной очереди входных событий.

Все три автоматических проверки native JSONL завершились кодом 0. Тот же
`scripts/qa/assert-chapter-boundary.mjs` на BEFORE завершается кодом 1 (`3 !== 2`).
[AFTER вперёд](evidence/android-2026-09-05/chapter-skip-after.jsonl),
[назад](evidence/android-2026-09-05/chapter-reverse-after.jsonl),
[быстрая серия](evidence/android-2026-09-05/chapter-fast-after.jsonl),
[видимая глава2](evidence/android-2026-09-05/chapter-skip-after.png).
Итого 36 физических переходов AFTER. Пропуск главы воспроизведён и исправлен;
это не отменяет оставшиеся ограничения общей release-приёмки.

## Заметки: привязка к книге, повторное добавление и редактирование

После cold reload финального Notes JS проверена собственная
`26-mixed-recovery`, id `762da51a-5d1b-41e7-9d2d-980508e76c9f`.
До прохода SQLite `highlights` пуст. Reader asset в этом проходе —
`9667fc81…` / фактический MD5 `1c33dccc56fb59327fce61a449d4cea6`;
последующий PDF selection-anchor фикс этим проходом не проверяется.

1. Book actions → Notes → нижняя кнопка пустого блокнота открывает редактор
   с выбранной книгой, а не глобальную заметку. Введён и сохранён собственный marker.
2. Header Add остаётся доступен в непустом блокноте. Вторая заметка сохраняется
   в ту же книгу; обе карточки видимы, не перекрываются. Английский UI показывает
   `Book note`, а не внутренний русский sentinel из БД.
3. Inline Edit → выделение → точная замена → Save меняет первую запись с id
   `d08947e3-7984-479a-ba18-5a42bf3c2db8`, не создавая третью. Вторая запись
   `387d35f8-52eb-46b0-a65a-785ac1061bf3` остаётся прежней. Read-only снимок
   SQLite и WAL подтверждает оба текста, оба `book_id` и `quick_check=ok`.
4. Back → чтение возвращает прежний CFI
   `epubcfi(/6/2!/4,/2,/16/1:102)` и те же 300 символов видимого фрагмента.
5. В другой собственной книге `15-large-original` блокнот показывает
   `No notes yet`, ни один marker первой книги не виден. SQL: всего 2 записи,
   у выбранной книги 2, у другой 0. Back сохраняет её прежний CFI
   `epubcfi(/6/2!/4,/162/1:251,/168/1:113)`.

[Создание с клавиатурой](evidence/android-2026-09-05/notes-create-keyboard.png),
[две карточки после Edit](evidence/android-2026-09-05/notes-two-records-edited.png),
[SQLite после обновления](evidence/android-2026-09-05/notes-sqlite-edited.json),
[пустой блокнот другой книги](evidence/android-2026-09-05/notes-other-book-empty.png),
[чтение до](evidence/android-2026-09-05/notes-reading-before.jsonl) и
[после](evidence/android-2026-09-05/notes-reading-after.jsonl).

Сценарии сохранены в `.maestro/android-own-book-note-*.yaml`,
`android-own-book-second-note.yaml`, `android-own-notes-return.yaml`,
`android-other-book-empty-notes.yaml`. Для inline замены применяется bounded
`scripts/qa/android-note-native-input.mjs`: он проверяет собственный marker
в активном native EditText, посылает физические Ctrl+A и короткие команды ввода,
проверяет точный результат, но сам не нажимает Save и не меняет SQLite.

Ограничение драйвера: исходный `eraseText` был выполнен при курсоре в начале,
а long-press не обеспечил ожидаемого выделения. Эти попытки не сохранялись.
Отдельный длинный `adb input text` дал только 6 из ожидаемых 43 символов;
в то же окно Android InputDispatcher зарегистрировал 131 строку
`Dropped event because it is stale`. События отвергались системой до редактора.
Контроль с 22 короткими командами и новыми timestamps сохранил все 43 символа
точно, затем реальный Save и SQLite проверены. По этому наблюдению код редактора
не менялся; оно не доказывает потерю доставленных символов приложением и не
является release-бенчмарком ввода.
[Paced native control](evidence/android-2026-09-05/notes-paced-input.jsonl),
[системные stale events](evidence/android-2026-09-05/notes-driver-stale-events.log).

Android Back/discard guard для несохранённого черновика не изменялся и здесь
не заявляется принятым. Native отказ SQLite намеренно не внедрялся: failure
paths покрыты отдельными поведенческими тестами. Пользовательские заметки не
удалялись. По завершении приложение оставлено на Library, активных Android
UI-драйверов нет, Fast Refresh остаётся OFF по согласованию с root.

## Android: контекстное меню выделенного текста

На установленном reader asset `8a06cd1a…` физический long press выделял слово
`diary` на странице 3 собственного PDF и `Анна` в собственной EPUB 26, но
панель Add note / Copy / Translate / Summarize не появлялась. Android показывал
два окна handles выделения, без floating toolbar. Это общий Android путь, не
ошибка только PDF. [PDF BEFORE](evidence/android-2026-09-05/selection-menu-blocked-before.png).

Причина подтверждена изолированным native A/B: document `contextmenu` handler
читалки вызывал `preventDefault`. В собственной EPUB временная capture-граница
на frame window останавливала только распространение этого события, сохраняя
действие по умолчанию. `defaultPrevented` менялся с true на false; тот же
физический long press показывал настоящую панель. Нажатие Add note открывало
ManualNote с правильной книгой 26. Черновик был пуст и не сохранялся.
[Native A/B](evidence/android-2026-09-05/selection-menu-isolated-after.png),
[реальный переход в редактор](evidence/android-2026-09-05/selection-menu-native-action.png),
[event evidence](evidence/android-2026-09-05/selection-menu-isolated.json).

Временный handler удалён после возврата, исходный CFI остался
`epubcfi(/6/2!/4,/2,/16/1:102)`;
[контроль возврата прежнего blocker](evidence/android-2026-09-05/selection-menu-probe-restored.json).
Bounded helper `scripts/qa/android-context-menu-probe.mjs` допускает только
собственную книгу 26, имеет отдельные inspect / allow / restore, не меняет
текст, CFI или SQLite. Этот A/B доказывает причину, но не заменяет последующий
installed AFTER исправленного production asset и PDF note page-anchor loop.

### Production menu и PDF page-anchor AFTER; отдельный navigation дефект

Cold reload asset SHA256 `c15fdf45c7c5b3291fd8da925d81d909543c90be0e8408dafb2356bdb1134830`,
фактический MD5 `6cb2e202bf7ae3cc9fc11a22c753e04d`: тот же физический long press
по `diary` на странице 3 PDF показывает штатную панель уже **без временных
обработчиков**. [Установленный menu AFTER](evidence/android-2026-09-05/pdf-selection-native-menu-after.png).

Add note → обычный ввод `NARRA_ANDROID_PDF_PAGE3` → Save создаёт запись
`c038d725-7324-4d5c-8eda-6b55879f3325` у PDF
`e243bab5-5ee3-439e-a40e-8b4e5b2e8078`: text=`diary`, CFI=`epubcfi(/6/6)`.
Read-only SQLite/WAL подтверждает все значения. Реальный next открывает
страницу 4 (`epubcfi(/6/8)`), Book actions → Notes → одно нажатие карточки
возвращает видимую страницу 3 и `epubcfi(/6/6)`. Maestro flow exit 0.
[SQLite](evidence/android-2026-09-05/pdf-note-sqlite.json),
[исходная страница](evidence/android-2026-09-05/pdf-note-page-before.jsonl),
[уход на следующую](evidence/android-2026-09-05/pdf-note-away-page-four.jsonl),
[возврат](evidence/android-2026-09-05/pdf-note-return-before-navfix.jsonl).

Это принимает menu / сохранённый page-anchor, но обнаружен отдельный общий
дефект: Notes открывает второй Reader той же книги. Настоящий navigation state
равен Tabs → Reader A → Notes → Reader B, вместо возврата в Reader A.
[Native stack BEFORE](evidence/android-2026-09-05/pdf-note-stack-before.json).
Он независимо воспроизведён также на iOS, исправляется отдельно и требует
повторного native loop. Бounded read-only observer —
`scripts/qa/android-note-navigation-observe.mjs`; он не dispatch-ит actions.

Ограничения драйвера: первый 45-секундный Library gate истёк во время холодной
загрузки debug bundle под общей нагрузкой: bootstrap начался 13:23:55 и
завершился 13:23:58 после запуска 13:22:54. Приложение дошло до Library без
повторного cold и без RedBox; этот замер не является release startup benchmark.
Первый page-4 AX assert выполнялся при открытых controls, которые штатно
заменяют счётчик; снимок/CFI уже показывали правильную страницу. После явного
закрытия controls тот же assert проходит. Эти попытки не считаются PDF
page-anchor регрессиями и не скрываются как успешные проверки.

## Тема: подписи настроек, системная строка и проверка System

На светлом Notes системные часы/иконки ранее были белыми на `#f5f5f5`:
доминантная пара пикселей clock ROI давала контраст 1,09. В установленном
`react-native-screens` `ScreenWindowTraits.kt:91` route без `statusBarStyle`
получает fallback `light`. RootNavigator теперь явно наследует `light` / `dark`
по текущей теме; отдельный Reader override не изменён. Actual mounted navigator
дал 2 RED → 3 GREEN; независимый root review принят.

Native Dark Notes AFTER сохраняет белые иконки на `#111111`, контраст 18,88.
[Dark Notes](evidence/android-2026-09-05/statusbar-dark-notes-after.png).
Отдельное Android исправление существующего Compose picker передаёт текущий
`colors.foreground`: подписи Theme / Language теперь читаемы и в тёмном режиме.
[Dark labels AFTER](evidence/android-2026-09-05/settings-dark-labels-after.png).
Формы, шрифты, размеры и поведение picker не переоформлялись.

Повтор System выявил **другую**, ранее неверно объяснённую только драйвером
ошибку: после Dark → System selector закрыт, поле действительно System,
Dark отсутствует в AX, но Profile и следующий Notes остаются тёмными.
Android `cmd uimode night` возвращает `no`, тогда как runtime RN Appearance
возвращает `dark`, а actual Uniwind config.native имеет `adaptive=false`.
PanelUIThemeBridge передавал библиотеке только resolved light/dark, и её
Appearance override возвращался обратно в app `useColorScheme`.
[System выбран, поверхность тёмная](evidence/android-2026-09-05/settings-system-restored.png),
[следующий Notes всё ещё тёмный](evidence/android-2026-09-05/theme-system-still-dark-before.png),
[read-only runtime](evidence/android-2026-09-05/theme-system-runtime-before.json).

Название оригинального screenshot `android-status-light-notes-after` в этом
первом flow было предположением, а не подтверждением светлой поверхности;
сам снимок сохранён как **System BEFORE**, не как light PASS. Системная тема
исправляется отдельно. Explicit Light служит независимым контролем statusbar,
а финальный возврат в исходный System требует отдельного native AFTER.

Explicit Light AFTER принят отдельно: после реального выбора Light → Library
→ Reader → Notes часы имеют foreground `#626262` на `#f5f5f5`, контраст **5,59**
против **1,09** до statusbar исправления. Dark control остаётся 18,88.
[Светлый Notes AFTER](evidence/android-2026-09-05/statusbar-light-notes-after.png),
[исходные pixel counts](evidence/android-2026-09-05/statusbar-colors.jsonl),
[native flow](evidence/android-2026-09-05/statusbar-light-flow.log).
Это локальное измерение clock ROI оригинальных PNG, не полный аудит WCAG.
Тема временно Light для этого контроля; исходный System ещё должен быть
восстановлен после независимого bridge исправления.

## Финальный d90: повторный возврат из заметок без копий Reader

На общем runtime с reader SHA256
`d90aa52a86faaf117ad70df54e4d993ffca9e8d61bc3a8b7f5914139c6f81159`
(реальный MD5 `23ce9e242d852241404f5a5b7d5c299d`) выполнены три физических
цикла PDF **страница 3 → страница 4 → Notes → сохранённая карточка → страница 3**.
После каждого CFI равен `epubcfi(/6/6)`, root stack — ровно Tabs / Reader,
и сохраняется исходный ключ `Reader-a-YPh48R_hVdIQkU-QD65`.
Скрытых Notes и второго Reader больше нет. Реальный Close после третьего
цикла сразу возвращает Library; root stack содержит только Tabs, index 0.

[Baseline](evidence/android-2026-09-05/note-navigation-baseline-after.json),
[первый](evidence/android-2026-09-05/note-navigation-after-1.json),
[второй](evidence/android-2026-09-05/note-navigation-after-2.json),
[третий](evidence/android-2026-09-05/note-navigation-after-3.json),
[третий CFI](evidence/android-2026-09-05/note-navigation-position-after-3.jsonl),
[Close state](evidence/android-2026-09-05/note-navigation-close-after.json),
[Close flow](evidence/android-2026-09-05/note-navigation-close-flow.log).
`scripts/qa/assert-android-pdf-note-return.mjs` проверяет реальные JSON/JSONL:
на исходном duplicate stack exit 1, на всех трёх AFTER exit 0.

Не скрытая оговорка: это **три принятых перехода заметки**, а не три полностью
безошибочных запуска Maestro. В первом и третьем сценариях панель не открылась
после команды center tap. Удаление повторного conditional tap само по себе не
устранило наблюдение: третий single tap + 10s AX gate тоже не прошёл.
Сохранены [журнал](evidence/android-2026-09-05/reader-center-maestro-inconclusive.log)
и [реальный экран](evidence/android-2026-09-05/reader-center-maestro-inconclusive.png).
Отдельный физический `adb input tap 540 1200` открыл controls, затем обычные
native Book actions / Notes / карточка завершили третий переход. Никакие
navigation actions или CFI через CDP не внедрялись. Случай не объявляется
ни доказанным дефектом приложения, ни полностью доказанной ошибкой драйвера;
input-delivery неопределённость остаётся в отчёте. Production-код по догадке
не менялся. Перепроверка на release/device необходима.

### System AFTER и исходные настройки

На том же d90 runtime после исправления bridge проведён Light → Dark → System
**без cold reload между переключениями**. Реальный Android остаётся `night=no`;
RN Appearance теперь `light`, actual Uniwind.native — `current=light`,
`adaptive=true`. Strict read-only observer завершился exit 0. Следующий Notes
и Library действительно светлые, системные иконки контрастные. Исходный режим
приложения **System восстановлен**, язык English и Android night mode не менялись.
[Runtime AFTER](evidence/android-2026-09-05/theme-system-runtime-after.json),
[светлый Notes](evidence/android-2026-09-05/theme-system-light-notes-after.png),
[светлая Library](evidence/android-2026-09-05/theme-system-library-after.png),
[native flow](evidence/android-2026-09-05/theme-system-final-flow.log).

Первый screenshot Profile сразу после выбора System ещё фиксировал тёмный
кадр; он не используется как финальный визуальный AFTER. Обновление Appearance
асинхронно, и задержка этого shared debug прогона не считается чистой метрикой
скорости переключения темы. Функциональная приёмка подтверждена последующим
экраном, runtime-state и повторным наблюдением без перезапуска приложения.

[Повторный settled Profile](evidence/android-2026-09-05/theme-system-profile-settled-after.png)
подтверждает System и светлую поверхность уже после перехода через Notes.
По завершении QA Fast Refresh возвращён **ON** через штатный переключатель
Expo dev menu; до него в native preferences было `false`, после — `true`.
[Native preference](evidence/android-2026-09-05/fast-refresh-restored.xml),
[штатное меню](evidence/android-2026-09-05/fast-refresh-restored.png).
Меню закрыто. Приложение оставлено на Library, root stack — только Tabs,
без скрытых Reader/Notes; [финальный state](evidence/android-2026-09-05/final-library-stack.json).
Оригинальные пользовательские книги/заметки не удалялись, добавлены только
собственные QA fixtures и три собственные заметки. Активных Android UI-драйверов
и временных contextmenu handlers нет. Никакого деплоя не было.
