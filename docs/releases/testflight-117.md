# Narra 1.4.0 (117) — TestFlight

1 октября 2026. Исправлены задержка отклика кнопок плеера и непрозрачная
верхняя шапка категории до прокрутки.

- Исходный commit: `73d1724233a648bd87c88dad2eeb91e89bdc1f14`.
- [EAS production iOS build](https://expo.dev/accounts/mishanaer/projects/readany/builds/7e1ddf0a-bfb2-43db-93b8-a377b774e195): `FINISHED`.
- IPA SHA-256: `837020eaaf4ec537027a1f2e65083f22dc7eafecf34a00cc879ad29daa7af17b`.
- В IPA проверены `com.mishanaer.narra`, версия `1.4.0`, номер `117`.
- Apple upload: `UPLOAD SUCCEEDED`, без ошибок. Прежнее предупреждение 90737 о настройке открытия документов не блокирует выпуск.
- [App Store Connect build](https://appstoreconnect.apple.com/teams/d8b33429-d4a7-418c-824a-45a168acda6f/apps/6801546949/testflight/ios/6e4d6e28-97e0-49de-aaac-122ce7a8c3c3): `VALID`.
- Beta review: `APPROVED`; external state: `IN_BETA_TESTING`.
- Сборка назначена группе `Narra External`; [публичная ссылка TestFlight](https://testflight.apple.com/join/6h3wT64n) активна.
- `What to Test` заполнено для `ru` и `en-US`, автоматическое уведомление тестировщиков включено.

До выпуска прошли 34 теста, TypeScript, Biome и проверка diff; на симуляторе
проверена шапка категории. Отклик физического хаптика и поведение именно
TestFlight-сборки на iPhone ещё нужно проверить вручную.
