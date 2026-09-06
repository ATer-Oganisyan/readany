# NARRA: пауза аудита 4 сентября 2026

Работа приостановлена по просьбе пользователя для включения Full Access.
Не считать аудит завершённым или принятым.

## Рабочая база

- `/Users/tsevdnkanduev/Narra`, ветка `codex/core-loop-audit-20260904` от `origin/main` `8d9d6bb`.
- Только `mishanaer/Narra`. Форк не используется. Ветка `narra/core-loop-polish` сохранена отдельно и не является актуальной базой.
- Все исправления в рабочем дереве, коммитов/публикации/деплоя не было.
- Установлен и включён `expo@openai-curated-remote` 1.0.2.

## Уже исправлено и проверено поведенчески

- Чтение: зависания анимации/секции/iframe, пропуск главы во время preload, потеря параллельных WebView ответов, гонка открытия книг, loader после ошибки. Субагент reader_fixes: 22 новые регрессии; reader suite 100/100 на момент завершения.
- Импорт: DB-before-publish, отдельные файлы до commit, rollback ошибок, последовательный импорт, сохранение прогресса при реимпорте, AI после локального сохранения, расширения/имена с `%`, UMD через EPUB, понятная ошибка AI для неподдерживаемых backend форматов. Субагент import_fixes: 20 новых тестов, связанный набор 63/63, TypeScript и Biome.
- Backend персонажей: ошибочный scan не превращается в успешный пустой результат, кэш успешной половины сохраняется, Unicode-границы для русских глав/родства/имён. Субагент history_audit: 310/310.
- Persist/прогресс: упорядоченные JSON writes, hydration не зависает на ошибке миграции, flush на background/blur/unmount. История hard-kill recovery ещё дорабатывалась при паузе — проверить незавершённый diff library-store.ts.
- Сцены: bounded request/save, независимая отмена потребителей, после отмены можно начать заново. Реальная PostgreSQL регрессия сначала показала queued вместо failed, затем прошла: polling сохраняет конечную ошибку; явный retry использует ту же job. Reader_fixes дополнительно исправил compatibility fallback для старого gateway, общий 30s recovery budget и increment попытки независимо от tracing.
- CI: добавлены мобильные проверки и PostgreSQL в gateway workflow, миграции до тестов, cost-ledger env. Reader_fixes сообщил actionlint PASS и mobile suite 948/948.

## Проверки в среде

- Временная PostgreSQL: `/private/tmp/narra-audit-pg.za38Vj/data`, localhost:55438, пользователь `narra_audit`, БД `postgres`, auth trust только loopback. `BOOK_MARKUP_TEST_DATABASE_URL=postgresql://narra_audit@127.0.0.1:55438/postgres`.
- Полный backend-прогон с этой БД прошёл exit 0; отдельный cost-ledger также PASS. S3 E2E ещё не запускались.
- iOS native build 36 выполнен штатным wrapper, `BUILD SUCCEEDED`.
- Доступный Simulator: iPhone 17 Pro Max, `391D4246-C13E-42B6-B7AF-15D3B7FD9DC6`, Xcode 26.5 `/Applications/Xcode.app`. PasteboardAutomaticSync выключен.
- Metro localhost:8081 уже работал и переиспользуется. Обычный wrapper launch+open URL несколько раз оставлял домашний экран; console launch без повторного URL оставил NARRA работающей. Причина ещё не установлена.
- Экран Library виден, локальная книга «Преступление и наказание» 1%, доступна accessibility-иерархия через Maestro. Полный iOS core loop ещё НЕ пройден.
- В логах был WebKit ENOSPC, затем df показывал 7 GiB свободного места. Ничего не очищали. Также есть предупреждение RN `Unsupported Role value: destructive` из существующего SwiftUI меню — не исправлено и не доказано причиной закрытия.
- Maestro 2.10.0 установлен; Homebrew Java доступна через `/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home`. Wrapper получил screenshot/logs/console/test-ios/hierarchy с теми же защитами Xcode/pasteboard.
- Fingerprint wrapper больше не реагирует на изменения package.json scripts; dependency changes по-прежнему обнаруживаются. Поведенческий тест PASS. После изменения fingerprint выполнена повторная штатная сборка, PASS.
- Android AVD `Readest_API_36_arm64` загружен (emulator-5554); NARRA не установлена, APK и android/ в проекте нет. Нативная Android сборка НЕ запускалась. Перед сборкой проверить место (последнее значение 6.5 GiB) и совместимую Java. Данные эмулятора сохранены.

## Что продолжить

1. Проверить, что среда действительно передала Full Access; не путать выбранный в UI режим с действующими разрешениями инструментов.
2. Спросить субагентов о состоянии прерванных задач: history_audit — recovery checkpoint vs устаревшая SQLite после kill; reader_fixes — bounded `readSceneDataUri` после download и CI/review; import_fixes — Android readiness.
3. Закончить эти изменения и независимо проверить diff. Пересобрать reader bundle после финальных правок.
4. Исправить i18n checksum: новые RU/EN common.json строки согласованы, но ENGLISH_SOURCE_REVISIONS.common.json ещё старый. Core suite ранее 586/587 по этой причине. Проверить итоговый RU SHA перед обновлением.
5. Пройти реальный iOS сценарий: открыть книгу, листать быстро и через главы, фон/возврат/kill, персонажи/чат, сцены и ошибки, импорт/реимпорт; зафиксировать снимки и результаты.
6. Решить Android build в рамках запрошенного прогона; не объявлять его проверенным без установки и UI тестов.
7. Финальные mobile/core/backend/typecheck/build проверки, итоговый отчёт с оставшимися ограничениями. Никакого деплоя без соответствующего основания/разрешения.

Backend исправления пока локальны. Уже опубликованная испорченная разметка сама не пересчитывается. У старого gateway fallback сохраняет совместимость клиента, но не исправляет его старое серверное поведение polling.
