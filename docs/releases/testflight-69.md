# Narra 1.3.5 (69) — TestFlight

Релиз 28 августа 2026. Предыдущий доступный билд — 1.3.5 (68):
App Store Connect подтвердил VALID / IN_BETA_TESTING для обеих групп.
Исходный код билда 68: `aa6ad64d49e1a8e6e9ef626e976490ce9936569e`.

## What to Test (en-US)

- Smoother search, tab switching, and category browsing.
- Improved catalog loading, offline recovery, and cover retries.
- Refined shelf spacing and headings. Search no longer opens the keyboard automatically.
- Updated character profiles and scene illustrations to use backend data, with improved recovery and retries.
- Switched book narration to SaluteSpeech, preserving character voices and improving speed changes and playback cancellation.
- Preserved book languages during import and added support for language-specific catalog APIs.

## Проверки и ограничения

- 741 тест / 80 файлов, TypeScript и lint 25 изменённых TS-файлов — exit 0.
- Нативный аудиоплеер проверен на локальных WAV; платный SaluteSpeech не вызывался.
- Языковые API проверены реальными GET из приложения. English endpoint отдаёт
  3 книги вместо 1000 из backend-отчёта; причина на серверной стороне не установлена.
  Новые языковые вкладки в интерфейсе не добавлялись.
- Улучшение времени переходов измерено в Debug, без обещания тех же чисел в Release.
  Ранее замеренные 50 циклов показали рост RSS, критерий стабильности памяти не пройден.
- Финальный Release на физическом телефоне до отправки не проверен.
- Профиль production, Gateway и существующие ключи сохранены. Только TestFlight,
  без публичной публикации в App Store.

## Готовый архив

- Исходный коммит: `d277cf64d4ddc8a961ddee75442cc9b51e300381`, отправлен в `origin/main`.
- Изолированный worktree: `/private/tmp/narra-testflight-69.7qq7lvjb`.
- Локальная EAS-сборка production, `--freeze-credentials --non-interactive`, exit 0.
  EAS увеличил remote build number с 68 до 69; облачная квота не использовалась.
- IPA: `/private/tmp/Narra-69-d277cf64.ipa`, 268 150 231 байт.
- SHA-256: `8a227e7b5b024a9a5100576004201ae1a8f517d411fe3c7106ca6e046ed69c42`.
- Внутри IPA подтверждены `1.3.5 (69)`, `com.mishanaer.narra`,
  Xcode `17F113`, SDK `iphoneos26.5`, App Store provisioning и `get-task-allow=false`.
- `codesign --verify --deep --strict` — exit 0. В bundle есть новые языковые
  API и книжный TTS-маршрут; локальная WAV-fixture отсутствует.
- Archive/dSYM: `/Users/manaer/Library/Developer/Xcode/Archives/2026-08-28/Narra 2026-08-28 17.42.21.xcarchive`.
  Совпадающий UUID приложения и dSYM: `5E79D27D-417C-35B0-8168-73DDD6E9A9FA` (arm64).
- SHA всех 16 изменённых runtime-файлов в build input совпали с проверенной версией.
  EAS сократил lockfile после исключения desktop-workspaces; версии оставшихся
  зависимостей не изменились, новых packages не добавлено.
- Expo Doctor: 19/21. Сохранились прежние замечания о `@expo/dom-webview@55.0.6`
  и patch-обновлениях Expo/RN; зависимости перед релизом не обновлялись.
- Отправка напрямую через Apple uploader, без создания очереди EAS Submit.
  Английский текст выше сохранён в `What to Test` локали en-US; совпадение проверено повторным чтением.

## Отправка в Apple

- Apple uploader завершился с exit 0 в 17:56:36 МСК 28 августа 2026.
- App Store Connect подтвердил получение `1.3.5 (69)`:
  upload/build ID `a69c777e-db24-4c4a-8cc1-42c0b96d92a2`.
  Обработка завершена: upload `COMPLETE`, build `VALID`.
- Группы **Narra Internal** и **Narra External** подключены; обе имеют
  `IN_BETA_TESTING`, автоматическое уведомление включено. Проверено через API
  после записи английского описания и назначения групп.
- [Сборка в App Store Connect](https://appstoreconnect.apple.com/teams/d8b33429-d4a7-418c-824a-45a168acda6f/apps/6801546949/testflight/ios/a69c777e-db24-4c4a-8cc1-42c0b96d92a2).
  [Приглашение в TestFlight](https://testflight.apple.com/join/6h3wT64n).
- Подтверждение отправки, проверка IPA и совпадения исходников — в
  [testflight-69](./testflight-69/).

## Безопасность диагностики

При проверке процесса локальной EAS-сборки в вывод инструмента попал аргумент
с данными подписи. Пользователь уведомлён; секретные значения не включены в эти
файлы или git. Сертификат не менялся: его отзыв и замена требуют отдельного
согласования. Рекомендована замена затронутого distribution-сертификата.
