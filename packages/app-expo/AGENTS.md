# Локальные правила запуска Expo

Эти правила действуют для `packages/app-expo` и дополняют корневой `AGENTS.md`.

## Канонический запуск

- Для ежедневного запуска iOS Simulator используй `./script/build_and_run.sh` из `packages/app-expo`.
- Ежедневный режим загружает Simulator, запускает или переиспользует Metro на localhost и открывает установленный dev-client. Он не запускает нативную сборку.
- Для отдельного Metro Simulator используй `./script/build_and_run.sh start`.
- Для Metro на физическом телефоне используй `./script/build_and_run.sh start-lan`.
- Нативную сборку и установку запускай только явно через `./script/build_and_run.sh rebuild-ios`.
- Перед диагностикой запуска используй `./script/build_and_run.sh check`.
- В Codex используй действия `Run`, `Run Metro`, `Run LAN`, `Rebuild iOS` и `Check iOS` из `.codex/environments/environment.toml`.

## Согласованность Xcode и буфера Simulator

- Все команды Simulator запускай только через `script/build_and_run.sh`: скрипт выбирает UI из того же Xcode, что и `DEVELOPER_DIR`/`xcode-select` (`Simulator.app` в Xcode 26 или `DeviceHub.app` в Xcode 27).
- Не держи одновременно запущенными Simulator или Device Hub из разных версий Xcode. Перед переключением Xcode останови booted-устройство и закрой оба UI-приложения; затем запусти `./script/build_and_run.sh check`.
- Держи `Edit > Automatically Sync Pasteboard` выключенным. На этой машине смешение Xcode при включённой синхронизации приводило к системным зависаниям вставки и `CoreDeviceError 26003` в DeviceHub.
- Не обходи проверки согласованности Xcode и pasteboard в wrapper-скрипте. `READANY_ALLOW_PASTEBOARD_SYNC=1` допустим только для явно запрошенного разового теста; после теста синхронизацию снова выключи.
- Если вставка на Mac начала зависать, не перезагружай Mac первым шагом: останови конкретное виртуальное устройство, закрой Simulator и Device Hub, выключи синхронизацию, замени объект буфера обычным текстом и проверь отсутствие новых ошибок `26003`.

## Ограничения

- Не используй `expo run:ios`, `expo start --ios` или корневые native-команды как ежедневный путь: они могут запустить нативную сборку и обойти проверки wrapper-скрипта.
- Не используй tunnel, `--tunnel`, ngrok или другие публичные туннели.
- Не устанавливай `.app` из произвольных `DerivedData` или `packages/app-expo/ios/build/*`. Канонический артефакт создаёт только `script/build_and_run.sh` в `ios/build/codex-devicehub`.
- Не подменяй установленную сборку приложением с тем же bundle ID без проверки build number и нативного fingerprint.
- Не запускай автоматический `prebuild --clean` и не удаляй `ios/` или `Pods`: нативный проект локальный и исключён из Git.
- Не редактируй native-файлы внутри `node_modules`. Проверенную правку оформляй через обновление зависимости или pnpm patch и проверяй после чистой установки.
- Не очищай DerivedData, Pods или Metro cache как обычный способ запуска. `--clear` используй только для целевой диагностики.

## Граница JS и native

- При изменениях только в JS/TS запускай Metro; существующий актуальный dev-client пересобирать не нужно.
- При изменениях в нативном коде, `app.config.js`, Podfile/Podfile.lock, нативных config plugins, `ios/`, `modules/*/ios` или составе нативных зависимостей запускай `rebuild-ios` после проверки fingerprint.
- Изменения только в JS/TS, reader assets или зависимостях без native-модулей не требуют пересборки dev-client.
- Если быстрый запуск не находит установленный dev-client или build number не совпадает, он должен завершиться с подсказкой `rebuild-ios`, а не начинать сборку сам.
- Если `Podfile.lock` и `Pods/Manifest.lock` расходятся, остановись и сообщи о рассинхронизации Pods. Не обходи проверку старым артефактом.

## Фиксированная конфигурация

- Workspace и scheme разрешаются `script/build_and_run.sh`; текущие значения — `ios/Narra.xcworkspace` и `Narra`.
- Bundle ID: `com.mishanaer.readany.dev`
- Simulator по умолчанию: `iPhone 17 Pro`
- Metro: `http://127.0.0.1:8081`
- DerivedData: `ios/build/codex-devicehub`

После запуска проверь, что приложение открылось без RedBox и экран «Библиотека» доступен. Если запуск упал, укажи точный этап: prerequisites, native build, install, Metro или runtime.
