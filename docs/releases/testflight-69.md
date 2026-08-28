# Narra 1.3.5 (69) — TestFlight

Подготовка 28 августа 2026. Предыдущий доступный билд — 1.3.5 (68):
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
  без публичной публикации в App Store. Номер и результат отправки будут подтверждены
  по готовому IPA и App Store Connect.
