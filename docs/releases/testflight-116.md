# Narra 1.4.0 (116) — TestFlight

1 октября 2026. Исправлены потеря завершения zoom-перехода при повторном
закрытии ридера и native crash при прокрутке Popular после перехода к книге.

- Исходный commit: `ec28505fbf21e7655c0ab8e8758ca5bd13db894e`.
- EAS production iOS build: `e139657d-1f5c-4e7e-8096-1bceeece9336`, `FINISHED`.
- IPA SHA-256: `3712fcf0c8b60d1b18a580a192c7456591a128503b7d926cc6ce46d5d065a7ec`.
- В IPA проверены `com.mishanaer.narra`, версия `1.4.0`, номер `116`,
  production API `https://api.narra.disrupt.builders`, distribution profile,
  наличие `addSnapshotToView` и `zoomContentView` в бинарнике.
- Apple upload: `UPLOAD SUCCEEDED`, без ошибок. Предупреждение 90737 о
  document configuration осталось прежним и не блокирует выпуск.
- App Store Connect build: `c9454744-6e95-4f09-9e0a-74a1fc8a8cef`, `VALID`.
- Beta review: отправлена и одобрена; external state `IN_BETA_TESTING`.
- Сборка назначена существующей внешней группе `Narra External`; публичная
  ссылка группы активна: https://testflight.apple.com/join/6h3wT64n.
- Описания проверки обновлены на русском и английском.

Проверка до выпуска: нативные Debug-сборки на физическом iPhone и iOS 27
Simulator прошли; пользователь подтвердил отсутствие прежнего лага. На
симуляторе проверены повторные открытия/закрытия и прокрутка Popular;
отдельная native-проверка подтвердила сохранение порядка Fabric-элементов
при перестановке UIKit. Длительное использование именно TestFlight-сборки
на телефоне ещё не проверено.

[Исследование и проверка](../performance/reader-close-freeze-2026-10-01.md).
[Сборка EAS](https://expo.dev/accounts/mishanaer/projects/readany/builds/e139657d-1f5c-4e7e-8096-1bceeece9336).
