# Narra — контекст для продолжения работы агентом

Срез подготовлен 19 августа 2026 года. Основная история ниже описывает работу до сегодняшней попытки запуска на Simulator. В конце отдельно зафиксировано, что произошло сегодня после этого среза.

## Продуктовый контекст

Narra — Expo/React Native iOS-приложение для чтения книг с персонажами, чатами и ридером. Основные экраны:

- «Чаты» — список персонажей и диалогов;
- профиль персонажа — портрет/видео, имя, действия «Чат», «Слушать», переход/ответ;
- ридер — текст книги, сцены, персонажи и нижняя панель действий;
- «Библиотека» — каталог и книги пользователя.

Рабочая директория: `/Users/manaer/Documents/Narra2`.

Expo-приложение: `/Users/manaer/Documents/Narra2/packages/app-expo`.

## Что просил пользователь и что менялось

### Навигация и иконки

Пользователь несколько раз уточнял визуал таббара и нижних панелей:

- все иконки таббара должны быть в filled-стиле;
- использовались семантические иконки `book`, `chat-bubble`, `person`, `magnifying-glass`;
- для действий профиля добавлены/заменены иконки `headphones` и `chat-bubble`;
- старые SF Symbols в нижней панели убраны;
- чипы в поле сообщения убраны;
- для отправки сообщения используется стрелка из референса пользователя;
- при переключении вкладки «Главная» список должен сохранять прежнюю позицию, а не возвращаться в начало.

### Ридер

Пользователь сообщил о кратком мигании интерфейса/текста при входе в ридер. Причина была в повторном применении стартового layout-прохода:

- один повтор выполнялся в `ReaderScreen` после `loaded`;
- второй — внутри `openBook` после `el.open()`;
- повторные стартовые настройки убраны, чтобы типографика применялась одним проходом до показа страницы.

Позже пользователь отдельно сообщил, что в ридере пропали шрифты и видео. Для видео согласована логика:

1. сразу показывать статичную картинку-постер;
2. поверх неё загружать видео;
3. после готовности видео показывать видео вместо постера.

### Профиль персонажа

Согласованное поведение профиля:

- под персонажем лежит статичный кадр/постер;
- видео загружается поверх постера и заменяет его после готовности;
- поверх изображения располагается нижний градиент;
- блюрная копия изображения используется как фон под градиентом;
- радиус Gaussian Blur: **5**;
- тень имени персонажа не должна обрезаться контейнером;
- имя должно оставаться на одинаковом расстоянии от нижней зоны независимо от того, в одну или две строки оно переносится;
- имя персонажа должно быть крупным и визуально привязанным к градиенту;
- в списках чатов и диалогов должны использоваться только статичные портреты, не видео;
- портреты в списках должны иметь обычное кадрирование, как раньше, без уменьшения персонажа внутри маленького кружка.

Отдельно пользователь заметил регрессию после добавления виджетов: пропал градиент под персонажем, а имя стало маленьким. Это нужно считать чувствительной зоной при дальнейших изменениях.

### Разбор проблем запуска

Ранее пользователь несколько раз видел два Simulator/Device Hub и старые состояния приложения. Зафиксированы правила:

- не запускать два UI Simulator/Device Hub из разных версий Xcode;
- использовать локальный Metro, без tunnel/ngrok;
- ежедневный запуск должен переиспользовать установленный dev-client;
- нативную пересборку запускать только явно через `rebuild-ios`;
- после запуска проверять отсутствие RedBox и наличие экрана «Библиотека».

## Git и завершённые изменения

Текущая ветка перед сегодняшней диагностикой:

- `main`;
- `HEAD`: `ac5b5dc0` — merge PR #45, stable iOS app icon;
- `origin/main` указывает на тот же коммит;
- PR #45 уже смержен.

Последовательность последних значимых коммитов:

```text
ac5b5dc0 Merge pull request #45 ... ios-stable-app-icon
9c38eab7 fix(expo): use stable iOS app icon asset
0262fb35 Merge pull request #44 ... fix-production-patch
cb5347e4 fix(expo): restore valid sonner patch
e32ef93d Merge pull request #43 ... eas-archive-scope
90db48ac fix(expo): limit EAS archive to production assets
97ce46e2 Merge pull request #42 ... testflight-public-beta
25e9f3e3 feat(expo): ship polished Narra beta
2945796c feat(expo): native reader navigation and appearance action
4da75687 feat(expo): reveal imported books after upload
8fe0f0a1 fix(expo): add library pager gap and clarify provider failures
6ed324bf fix: polish character chat and library paging
07f6fff6 fix: recover rejected Narra installations
f00cce03 chore: bump iOS build to 36
```

## Текущее состояние незакоммиченных изменений

На момент подготовки handoff `git status` показывает только изменения gateway URL:

```text
 M eas.json
 M packages/app-expo/.env.development
 M packages/app-expo/eas.json
```

В этих файлах тестовые/dev-профили переключены с:

```text
https://api.narra.disrupt.builders
```

на:

```text
https://api-test.narra.disrupt.builders
```

Эти изменения не были частью текущего handoff и не должны быть случайно потеряны или откатаны. Перед коммитом нужно отдельно подтвердить, должны ли production/preview/dev-конфигурации использовать test gateway.

## TestFlight

Пользователь попросил залить сборку напрямую в TestFlight и сделать доступ по публичной ссылке без приглашений и invite-кодов.

Подтверждённые параметры:

- приложение: Narra;
- версия: `1.3.5`;
- iOS build: `36`;
- bundle identifier production: `com.mishanaer.narra`;
- App Store Connect app ID: `6801546949`;
- внешняя группа: `Narra External`;
- public link включён;
- ссылка: <https://testflight.apple.com/join/6h3wT64n>.

Что сделано:

1. EAS submission зависла в `Queued / Free Tier Queue` из-за инцидента с загрузками iOS в App Store Connect.
2. Локальный IPA уже был собран и провалидирован:
   `/tmp/narra-production.cCE3S0/export-v2/Narra.ipa`.
3. IPA напрямую загружен Apple через Xcode `altool`.
4. Apple приняла загрузку без ошибок; delivery UUID совпал с ID build-записи.
5. Build 36 появился в App Store Connect со статусом `VALID`.
6. Build 36 добавлен в группу `Narra External`.
7. Для build 36 обновлено описание `What’s New`.
8. Build 36 отправлен на внешнее Beta Review.
9. Review одобрен, состояния стали:

```text
betaReviewState: APPROVED
externalBuildState: IN_BETA_TESTING
internalBuildState: IN_BETA_TESTING
```

Следствие: тестирователям можно отправлять публичную ссылку. Новому тестеру нужен обычный Apple Account для TestFlight, но не аккаунт разработчика и не invite-код. Уже добавленным тестерам нужно нажать «Обновить», если TestFlight показывает build 35.

Временный App Store Connect private key после загрузки удалён с диска. Его содержимое в этот файл не переносить.

## Правильный запуск iOS Simulator

Канонический путь находится в:

```text
/Users/manaer/Documents/Narra2/packages/app-expo/script/build_and_run.sh
```

Режимы:

```bash
cd /Users/manaer/Documents/Narra2/packages/app-expo

# Ежедневный запуск: Metro + уже установленный dev-client, без xcodebuild
READANY_SIMULATOR_ID=0BF9EADF-9068-40CC-B93B-E5203BB77C09 ./script/build_and_run.sh simulator

# Проверка окружения
./script/build_and_run.sh check

# Отдельно Metro
./script/build_and_run.sh start

# Нативная пересборка только при явной необходимости
./script/build_and_run.sh rebuild-ios
```

Фиксированная конфигурация проекта:

- workspace: `packages/app-expo/ios/Narra.xcworkspace`;
- scheme: `Narra`;
- development bundle ID: `com.mishanaer.readany.dev`;
- scheme для Metro: `readany-dev`;
- Metro: `http://127.0.0.1:8081`;
- default simulator по правилам проекта: `iPhone 17 Pro`;
- сегодня фактически был booted `iPhone 17`, UDID `0BF9EADF-9068-40CC-B93B-E5203BB77C09`;
- canonical DerivedData: `packages/app-expo/ios/build/codex-devicehub`.

## Что произошло при сегодняшней попытке запуска

Это отдельный блок после основного среза.

1. Сначала был ошибочно вызван XcodeBuildMCP напрямую с workspace `Narra.xcworkspace`, scheme `Narra` и bundle ID `com.mishanaer.narra`. Это запустило отдельный нативный build в XcodeBuildMCP DerivedData, а не канонический wrapper-скрипт проекта.
2. Этот build компилировал React Native/Expo pods более пяти минут. XcodeBuildMCP вернул timeout после 300 секунд, хотя дочерний `xcodebuild` ещё продолжал работу. После проверки дочерний процесс завершился/был остановлен.
3. Затем был вызван правильный ежедневный wrapper в режиме `simulator`. Он нашёл установленный development client build 36, переиспользовал Metro на порту 8081 и запустил `com.mishanaer.readany.dev` на booted iPhone 17.
4. Проверочный screenshot показал RedBox:

```text
[runtime not ready]: ReferenceError:
Property 'MessageQueue' doesn't exist
```

Следовательно, Simulator и dev-client действительно запускаются, но JS runtime не проходит инициализацию. Это ещё не доказательство ошибки конкретного UI-экрана. Нужно найти источник обращения к `MessageQueue` в Metro/Hermes stack или в несовместимом native/dev-client runtime.

Важно: исходный код приложения не содержит прямого совпадения `MessageQueue` по `rg`, поэтому вероятнее всего проблема находится в зависимости, dev-client/native runtime, Metro cache или несовпадении native/JS variant. Не делать вывод, что это ошибка таббара или ридера, пока не снят полный stack.

## Ближайшая задача следующему агенту

1. Не запускать `mcp__xcodebuildmcp__build_run_sim` для ежедневного запуска.
2. Выполнить `./script/build_and_run.sh check` из `packages/app-expo`.
3. Проверить, какой процесс поднял Metro и с какими переменными (`APP_VARIANT=development`, scheme `readany-dev`, port 8081).
4. Снять полный Metro/Hermes stack для `MessageQueue` и определить пакет/код-источник.
5. Если Metro stale, штатно перезапустить его через `./script/build_and_run.sh start`; `--clear` использовать только после подтверждения, что проблема именно в кэше.
6. После исправления снова запустить `./script/build_and_run.sh simulator` и проверить, что открылась «Библиотека» без RedBox.
7. Не трогать незакоммиченные gateway URL без отдельного решения пользователя.

## Ограничения

- Не использовать `ngrok`, Expo tunnel или другие публичные туннели.
- Не запускать одновременно Simulator и Device Hub из разных Xcode.
- Не удалять `ios/`, Pods или DerivedData как первый способ исправления.
- Не устанавливать произвольный `.app` из стороннего DerivedData.
- Не добавлять секреты, App Store Connect private keys или токены в репозиторий/этот handoff.
