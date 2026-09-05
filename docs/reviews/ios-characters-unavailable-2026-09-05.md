# iOS: проверка недоступной генерации персонажей — заблокирована до входа

Область: только изолированный iPhone Air `984D0C64-C0B2-4204-92A9-2C65519089E8`, build 36, Metro 8082, LOCAL gateway 18787. Провайдеры постоянного gateway не настроены; успешная AI-генерация не проверялась.

## Фактическая последовательность

- 20:09 МСК: canonical check успешен, screenshot показывает Library/My books с двумя собственными книгами. Read-only inspector в 17:09:07.722 UTC подтверждает LOCAL и сохранённые позиции. Screenshot: `/private/tmp/narra-air-resume-preflight.png`; hierarchy: `/private/tmp/narra-air-resume-preflight-hierarchy.txt`.
- 20:09:32.867 МСК: согласно новым crash reports, одновременно завершаются Narra PID 7805 и SpringBoard PID 26950. У обоих `EXC_BAD_ACCESS / SIGSEGV`, адрес `0x20`, верхний frame `__66-[XCTAutomationSession initWithAccessibilityFramework:dataSource:]_block_invoke + 192`.
- 20:11:12: canonical `test-ios /private/tmp/narra-air-characters-unavailable.yaml`, session 97919, завершается на первом `assertVisible: Library`. Ни один tap сценария не выполнен. Screenshot показывает SpringBoard. Повторный read-only inspector не находит Air runtime.
- После обнаружения завершения приложения новые UI-действия, перезапуски, сборки и AI-запросы не выполнялись.

Артефакт попытки: `~/.maestro/tests/2026-09-05_201112/narra-air-characters-unavailable/screenshots/step-003-assertCondition-Library.png`. Исходные crash reports оставлены локально: `~/Library/Logs/DiagnosticReports/Narra-2026-09-05-200955.ips` и `SpringBoard-2026-09-05-200955.ips`; полные системные логи не копировались в репозиторий.

## Сохранность данных

Read-only SQLite после неудачной попытки подтверждает ровно две неудалённые собственные книги:

| Книга | ID | Прогресс | Точный CFI |
| --- | --- | --- | --- |
| Аудит 27 — Граница глав | `44da976d-50a6-4dd8-95e7-208dbeacc4cf` | `0.217477357205993` | `epubcfi(/6/2!/4/2[chapter-1],/34/1:35,/38/1:252)` |
| Аудит 30 — Импорт после исправления запуска | `d9d5f55a-a220-4d9e-a85c-443212d1384e` | `0.0310681938865705` | `epubcfi(/6/2!/4/2[chapter-1],/2,/8/1:34)` |

## Вывод и границы

Сценарий Reader → Characters → недоступная генерация → возврат **не выполнен**. Синхронный одинаковый сбой приложения и SpringBoard в XCTest automation — сильное свидетельство сбоя инструментария AX; точная первопричина ещё не установлена. Это не доказательство дефекта Characters и не основание принимать пользовательский путь. Данные и позиция p7 сохранены по SQLite, но UI-восстановление после этого завершения не проверялось. Следующий запуск требует отдельной координации с root.
