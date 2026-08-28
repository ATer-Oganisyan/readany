# Narra 1.3.5 (70) — TestFlight

Релиз 28 августа 2026. Основа: 1.3.5 (69).
Исходный коммит: `fb22e6084a41d3171feb48ecb4039a53b9e857dd`, отправлен в `origin/main`.

## What to Test (en-US)

- Fixed opening character chats from a character profile. Chats now open in a sheet with a close button and return to the same book page.
- Removed the false “Character unavailable” state when opening a newly unlocked character.
- Updated the portrait retry icon and aligned the character action buttons.
- Added light haptic feedback to scene generation controls, including retry and animation actions.

## Проверки и ограничения

- 761 тест / 84 файла, TypeScript и lint изменённых файлов шита — exit 0.
- В iOS Simulator проверены открытие карточки, переход в чат-шит с xmark,
  закрытие крестиком и возврат на ту же страницу книги.
- Регрессионными тестами проверены синхронизация прогресса до открытия
  персонажа, загрузка карточки без ложной недоступности и light-haptics сцен.
- Свайп закрытия в Simulator не подтверждён. Физический iPhone и Release
  на устройстве до отправки не проверены; тактильная отдача проверена на уровне вызовов.
- Expo Doctor: 19/21. Сохранились замечания о `@expo/dom-webview@55.0.6`
  и доступных patch-обновлениях; зависимости перед релизом не обновлялись.
- Production-профиль, Gateway и существующие ключи сохранены.
  Только TestFlight, без публичной публикации в App Store.

## Сборка

- Изолированный worktree: `/private/tmp/narra-testflight-70-fb22e608`.
- Локальная EAS-сборка production, `--freeze-credentials --non-interactive`.
- EAS увеличил remote build number с 69 до 70; облачная квота не использовалась.
- Все 15 изменённых runtime-файлов и ресурсов в build input совпали с коммитом.
- Сборка завершилась с exit 0. IPA: `/private/tmp/Narra-70-fb22e608.ipa`, 268134010 байт.
- SHA-256: `be401038ac20f1e9a6f9401bc07f2fba1257c230ff083f4cb8c69131562f4ff5`.
- В IPA подтверждены `1.3.5 (70)`, `com.mishanaer.narra`, Xcode `17F113`,
  SDK `iphoneos26.5`, App Store provisioning и `get-task-allow=false`.
- `codesign --verify --deep --strict` — exit 0. В bundle есть новая иконка
  `arrow-rotate-ccw-up`; локальная TTS-fixture отсутствует.
- Apple uploader завершился с exit 0 в 22:12:37 МСК 28 августа 2026.
  Подтверждено: `Successfully uploaded the new binary to App Store Connect`.
- App Store Connect подтвердил `VALID` для build ID `70e1ef6a-bf3e-4f12-93b0-dfe649a2dfad`.
- Группы **Narra Internal** и **Narra External** подключены; обе имеют
  `IN_BETA_TESTING`, автоматическое уведомление включено. Английский `What to Test`
  сохранён и проверен повторным чтением через API.
- [Сборка в App Store Connect](https://appstoreconnect.apple.com/teams/d8b33429-d4a7-418c-824a-45a168acda6f/apps/6801546949/testflight/ios/70e1ef6a-bf3e-4f12-93b0-dfe649a2dfad).
  [Приглашение в TestFlight](https://testflight.apple.com/join/6h3wT64n).
- Подтверждения отправки, проверки IPA и совпадения исходников — в [testflight-70](./testflight-70/).

- Archive/dSYM: `/Users/manaer/Library/Developer/Xcode/Archives/2026-08-28/Narra 2026-08-28 21.55.59.xcarchive`. Совпадающий UUID приложения и dSYM: `B55E8FB5-1865-3BBD-AE4A-8D65E1FB5FFB` (arm64).
