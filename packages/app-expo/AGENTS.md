# Локальные правила запуска Expo

Эти правила действуют для `packages/app-expo` и дополняют корневой `AGENTS.md`.

## Канонический запуск

- Для полного запуска на iOS Simulator используй только `./script/build_and_run.sh ios` из `packages/app-expo`.
- Для отдельного Metro используй `./script/build_and_run.sh start`.
- Перед диагностикой запуска используй `./script/build_and_run.sh check`.
- В Codex используй действия `Run iOS`, `Run` и `Check iOS` из `.codex/environments/environment.toml`.

## Ограничения

- Не используй `expo run:ios`, `expo start --ios` и корневую команду `pnpm expo:ios:simulator` с Xcode 27: Expo CLI 55 ищет удалённый Apple `Simulator.app` вместо `DeviceHub.app`.
- Не используй tunnel, `--tunnel`, ngrok или другие публичные туннели.
- Не устанавливай `.app` из произвольных `DerivedData` или `packages/app-expo/ios/build/*`. Канонический артефакт создаёт только `script/build_and_run.sh` в `ios/build/codex-devicehub`.
- Не подменяй установленную сборку приложением с тем же bundle ID без проверки build number и нативного fingerprint.
- Не запускай автоматический `prebuild --clean` и не удаляй `ios/` или `Pods`: нативный проект локальный и исключён из Git.

## Граница JS и native

- При изменениях только в JS/TS запускай Metro; существующий актуальный dev-client пересобирать не нужно.
- При изменениях в `app.config.js`, `package.json`, `pnpm-lock.yaml`, `patches/`, `ios/`, `plugins/` или `modules/*/ios` полный `Run iOS` обязан проверить fingerprint и пересобрать dev-client.
- Если `Podfile.lock` и `Pods/Manifest.lock` расходятся, остановись и сообщи о рассинхронизации Pods. Не обходи проверку старым артефактом.

## Фиксированная конфигурация

- Workspace: `ios/ReadAnyDev.xcworkspace`
- Scheme: `ReadAnyDev`
- Bundle ID: `com.mishanaer.readany.dev`
- Simulator по умолчанию: `iPhone 17 Pro`
- Metro: `http://127.0.0.1:8081`
- DerivedData: `ios/build/codex-devicehub`

После запуска проверь, что приложение открылось без RedBox и экран «Библиотека» доступен. Если запуск упал, укажи точный этап: prerequisites, native build, install, Metro или runtime.
