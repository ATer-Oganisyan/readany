# Narra 1.4.0 (115) — TestFlight

1 октября 2026. Выпущен backport react-native-screens #4407 в существующем
pnpm patch. **Проверка на физическом iPhone после публикации показала, что
зависание ридера сохранилось. Build 115 не считается исправлением этого бага.**

- EAS build: `c6ac05cb-f6ab-4c1c-a63c-f81126763e03`.
- Профиль и окружение: `production`; bundle ID `com.mishanaer.narra`.
- Базовый commit: `b561ed0c10ba47913b7a3ccde6d7e24abd9d80ea` плюс незакоммиченный фикс.
- SHA-256 patch: `faba320789719375f725691d47e8fe5d0291cdb11f546da0d5ccfface4e6158c`.
- SHA-256 lockfile: `65b47b796d36fcc1236d9ca9c1bf7326ac3b5068246fc3d1ee3487228977c4c8`.
- Перед сборкой: native Simulator build успешен; 16 циклов на iOS 27 без зависания,
  10 из Popular и 6 из My books; ponytail-review без замечаний.
- EAS build завершён. IPA SHA-256: `ab10935564a34b93be0db399de06223153f23ea75b1585321fcf5faa9d3d2812`.
- В IPA проверены production gateway в Hermes bytecode, номер 115, App Store
  provisioning и codesign. В бинарнике присутствует `addSnapshotToView`, старый
  `setViewToSnapshot` отсутствует.
- EAS Submit `3e84fd43-0767-4cac-977c-168b00cd2f53` отменён после длительного
  ожидания в очереди. Тот же IPA отправлен напрямую `xcrun altool` через
  существующий App Store Connect API key, как предыдущий релиз 114.
- Apple upload: `UPLOAD SUCCEEDED`, 1 октября 2026 в 16:39 MSK.
- ASC build ID: `453e423a-7f5b-48ad-9ce0-6b8530a6989f`; processing `VALID`.
- Beta review `APPROVED`; internal/external states `IN_BETA_TESTING`.
- Существующая группа Narra External содержит build 115, описания проверки
  обновлены на русском и английском. Новые группы и приглашения не создавались.
- [Публичный TestFlight](https://testflight.apple.com/join/6h3wT64n).
- Apple повторила существующее предупреждение 90737 о document configuration;
  оно не блокирует загрузку. Проверка самого Release на физическом iPhone остаётся
  за тестировщиком; локально проверен dev-client на iOS 27.

[Исследование и проверка](../performance/reader-close-freeze-2026-10-01.md).
[Сборка EAS](https://expo.dev/accounts/mishanaer/projects/readany/builds/c6ac05cb-f6ab-4c1c-a63c-f81126763e03).
