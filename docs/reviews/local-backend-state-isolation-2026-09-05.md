# LOCAL backend: изоляция состояния перед мобильным QA

Дата: 2026-09-05. Статус: read-only аудит и затем согласованный cache-only patch с регрессиями; endpoint, Metro и устройства не переключались. Таблица ниже фиксирует состояние до patch, итог исполнения — в последнем разделе. Повреждение данных реальной библиотеки не воспроизводилось.

## Вывод

Переключать существующий TEST dev-client на LOCAL с прежним контейнером пока небезопасно. Endpoint-scoped SecureStore credentials уже реализованы, но AI-состояние, каталог и медиа не изолированы. Backup позволяет восстановление, однако не предотвращает изменения и не является доказательством изоляции.

## Подтверждённые места риска

| Компонент | Текущее поведение | Риск LOCAL |
| --- | --- | --- |
| `packages/app-expo/src/lib/ai/narra-gateway-fetch.ts` | `installationStorageKey` выделяет ключи для localhost,127.0.0.1,[::1],10.0.2.2; normalizer приватный | Credentials защищены, но эта схема не применяется к остальным данным. Не создавать другой normalizer с иными правилами |
| `packages/app-expo/src/stores/narra-store.ts` | Общий `narra-interactive`, книги по локальному bookId; binding без endpoint | LOCAL заменит TEST binding/manifest/персонажей/сцены в той же записи; чаты и память также находятся в этой записи |
| `packages/app-expo/src/stores/persist.ts` | JSON в `Documents/readany-store`, debounce500ms, очередь записи | Восстановление JSON при работающем процессе может быть перезаписано очередью. Закрытие Reader не останавливает все операции |
| `packages/app-expo/src/lib/narra/backend-book-sync.ts` | reuse binding, sessions/bindings по bookId, expiredEditions по editionId | TEST edition уходит на LOCAL;404 может вызвать rebind и перезапись. Старые pending callbacks не имеют endpoint fence |
| тот же `backend-book-sync.ts` | identity обновляет title/author, applyBookLanguage — язык, catalog resolve — sourceKind/edition/catalogKey/hash/revision | LOCAL может поменять исходные metadata общей SQLite. Изоляция только Narra JSON недостаточна |
| `packages/app-expo/src/lib/narra/backend-character-media.ts` | `narra-backend-media/edition/type/hash.ext`, active/verified по destination | SHA/size защищают байты, но не разделяют окружения и операции при совпавших IDs |
| `packages/app-expo/src/lib/narra/backend-scene-file.ts` | `narra-media/backend-scene-SHA(edition,markup,scene).ext` | Совпадение IDs на двух серверах приводит к тому же пути; успешная загрузка заменяет прежний файл |
| `packages/app-expo/src/lib/narra/backend-catalog-cache.ts` | Общий `narra-backend-catalog`, отдельно язык, но не endpoint | LOCAL каталог/обложки могут заменить TEST кэш уже при открытии Library |

`startImportedBackendBook` держит импортную синхронизацию до пяти минут: выход из Reader не гарантирует прекращения фоновых записей. `backendSceneMarkupIdentity` и `BackendBookBinding` не включают сервер; revision guard может также отклонить LOCAL revision как более старую после TEST.

## Минимальная безопасная стратегия

Предпочтительный временный вариант — отдельный QA app container с отдельной библиотекой и исключительно собственными фикстурами. Не устанавливать второй бинарник поверх того же bundle ID. Выбор отдельного контейнера/сборки согласовывается отдельно.

Для одного контейнера необходимы обе части:

1. LOCAL-only namespace для persisted AI state, каталога, сцен и character media. Существующие remote ключи/пути сохраняются буквально; миграция/удаление TEST данных не нужна.
2. Запрет LOCAL записи server-derived metadata/catalog identity в ранее существующие TEST книги; отдельная server identity и endpoint fence у асинхронной работы. LOCAL QA только на новом собственном bookId, импортированном после переключения.

`backendOriginalSource` — сохранённые исходные байты/метаданные TXT и производного FB2, а не просто серверный кэш. Не удалять их при очистке/изоляции AI. Для LOCAL должно оставаться доступно безопасное чтение исходного файла, без перезаписи ссылок TEST книги.

До переключения: согласованный остановленный runtime, полная копия контейнера и согласованный snapshot SQLite+WAL, снимок metadata/CFI всех книг, отдельный учёт SecureStore без раскрытия секретов. После возврата — сравнение TEST JSON/файлов/метаданных и проверка чтения. Не восстанавливать backup поверх активных очередей записи. Этот протокол ещё не выполнен в рамках аудита.

## Предложение bounded cache-only реализации

Это отдельный подготовительный PR-hunk, **не разрешение на LOCAL mobile QA**: он не закрывает Narra state и SQLite риски.

- Новый чистый `packages/app-expo/src/lib/ai/narra-gateway-scope.ts`: вынести существующее определение LOCAL и кодирование `origin + pathname без завершающих /` из `installationStorageKey`. На вход строка URL, на выход необязательный filesystem-safe scope. Порты и path prefixes должны различаться. Не включать credentials/query в ключи; не сливать localhost и127.0.0.1 без отдельного решения.
- В `narra-gateway-fetch.ts` только делегировать прежнему поведению общего helper. Existing token keys должны совпасть побайтно. Не менять authMode, env resolution, регистрацию или транспорт.
- Новый тонкий `backend-cache-scope.ts` использует существующий `getNarraGatewayConfig`, не читает env самостоятельно. Возвращает прежний путь для remote и дочерний local-scope путь для LOCAL.
- Применить к `backend-catalog-cache.ts` (metadata/current/previous/covers), `backend-character-media.ts` (root; active/verified автоматически разделяются полным destination) и `backend-scene-file.ts` (directory, включая temp).
- Scope фиксировать в начале операции. Не пересчитывать destination после await. Для каталога учитывать singleton `backendCatalogStorage`, `coverDirectories`: холодное создание модуля под endpoint либо явный scope-keyed factory; не объявлять поддержку hot switch, пока sessions не fenced.
- Не менять `narra-store`, `backend-book-sync`, оригинальные файлы, SQLite, реальные endpoints и native binaries в этом cache-only шаге.

На этапе первого отчёта это было только proposal: общий security-sensitive контракт нормализации и module singleton lifetime требовал согласования. После согласования root выполнен только этот cache-only объём (см. ниже).

## Поведенческие регрессии для cache-only шага

1. Общий normalizer: remote→undefined; LOCAL default/explicit ports, pathname/trailing slash; разные endpoint prefixes различаются; exact старые token keys не меняются (`narra-gateway-fetch.test.ts` уже содержит LOCAL18787/18788 сценарии).
2. Реальный storage API на in-memory FS: TEST записал catalog current/previous → LOCAL записал другой → TEST снова читает прежние байты. Проверять read/write/move paths, не source-text matching. Добавить рядом с `backend-catalog-cache.ts`.
3. `backend-character-media.test.ts`: одинаковые edition/type/hash на TEST и LOCAL дают разные destination, не делят active job; LOCAL ошибка/отмена не удаляет TEST файл. Возврат TEST использует прежний проверенный файл.
4. `backend-scene-file.test.ts`: одинаковые edition/markup/scene на TEST и LOCAL. LOCAL successful replacement/cleanup оставляет TEST содержимое; возвращение TEST сохраняет legacy path. Существующий hash mock всегда даёт `hash`, что полезно для явной проверки directory isolation.
5. Отложенная загрузка A, переключение test factory на B, затем late completion A: результат остаётся в захваченном namespace A. Это проверка файлов, не гарантия session publication isolation.

## Следующий отдельный gate перед LOCAL mobile AI

После cache-only: persisted TEST→LOCAL→TEST state roundtrip; binding не используется поперёк endpoint; late manifest/media не публикуется в другой scope; LOCAL identity не меняет TEST title/author/language/sourceKind/CFI. До этих тестов LOCAL QA в исходном TEST контейнере не принят.

## Выполнено после согласования: cache-only

- `narra-gateway-scope.ts` содержит прежний алгоритм без изменения кодирования; `narra-gateway-fetch.ts` делегирует ему. Проверено точное старое значение SecureStore token key для LOCAL18787, не только отсутствие TEST token в запросе. Credentials/query не входят в scope; ports/path prefixes разделяются.
- `backend-cache-scope.ts` возвращает прежний remote root либо его дочерний `local/<encoded-endpoint>`. Каталог и обложки фиксируют scope при загрузке модуля; старый singleton продолжает писать в свой scope. Это не hot-switch API.
- Scene и character media фиксируют root до первого await; temporary/final paths, active/verified character keys разделяются по endpoint. Никаких миграций или удаления прежних remote файлов.
- Регрессии исполняют production storage/materialize функции с in-memory filesystem adapter: TEST current/previous → LOCAL → TEST, одинаковые catalog/edition/scene IDs, обложки, позднее завершение LOCAL загрузки после изменения test config, сохранность TEST байтов/legacy paths. Это не source-text assertions и не native filesystem acceptance.
- До fix три сценария изоляции упали: каталог прочёл TEST вместо пустого LOCAL, character media переиспользовал TEST asset, scene получил тот же destination. Один дополнительный timeout старого character теста был каскадом незавершённого mock ожидания после RED, не отдельным продуктовым багом. После fix они проходят.
- Финальный полный mobile прогон: **167 suites / 1491 tests PASS**, TypeScript PASS, `git diff --check` PASS. Включены cover roundtrip, точный credential-key assertion и native directory URI с завершающим `/`: LOCAL join не создаёт двойной slash, remote URI сохраняется буквально. Логи: `/private/tmp/narra-cache-full-final.log`, `/private/tmp/narra-cache-ts-final.log`; первоначальный RED: `/private/tmp/narra-cache-red.log`.

Не выполнено и не заявляется: endpoint isolation `narra-store`, sessions/bindings, publication fence, SQLite metadata guard; native TEST→LOCAL→TEST проверка. Поэтому LOCAL AI QA с существующей TEST библиотекой всё ещё **не принят**. Ни реальные endpoints, ни устройства, ни исходные книги/SQLite не изменялись. Expo native-data-fetching использован для границы кэширования и build-time endpoint lifetime; новый сетевой стек/зависимости не добавлялись.

Независимое ревью:49 targeted PASS, блокирующих дефектов коротких LOCAL URL нет.
Найден крайний случай длинного URL-prefix: hex component превышал NAME_MAX.
Root воспроизвёл отдельным RED тестом и разделил только файловый scope на
компоненты до240 символов; credential encoding и короткие пути не изменены.
После правки root:167 suites /1492 PASS, TypeScript PASS. Полный native filesystem
тест длинного префикса не выполнялся; проверено построение production пути.
