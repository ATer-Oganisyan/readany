# iOS: активный импорт → Reader → оглавление → отмена

## Результат

**P2: Cancel визуально присутствует в открытом оглавлении, но отсутствует в семантическом поиске AX.** После закрытия оглавления кнопка снова доступна; отмена в Reader выполнена до таймаута, соединение закрыто, книги и точная позиция сохранены. Полный AX/VoiceOver путь через оглавление **не принят**. Продуктовый код не изменён.

## Окружение и границы

- Только iPhone Air `984D0C64-C0B2-4204-92A9-2C65519089E8`, установленный dev-client build36; все UI действия через canonical `build_and_run.sh test-ios`. Без запуска/пересборки приложения, сбросов и изменений TEST.
- Inspector15:44:35.896 UTC: LOCAL gateway `http://127.0.0.1:18787`, development/installation, Metro8082; own27 открыт на p7, две книги.
- Own27 ID `44da976d-50a6-4dd8-95e7-208dbeacc4cf`, CFI `epubcfi(/6/2!/4/2[chapter-1],/34/1:35,/38/1:252)`, progress0.21747735720599323.
- Установленный архив own27 и `/private/tmp/narra-audit-import-fixtures/27-fresh-boundary.fbz` имеют одинаковый SHA256 `e8c0288c81ed16c26ac22affc8ab02b95a22cd8ab5481ed626caf95a77cf79f8`. Повторного импорта этой книги не было.
- Сервер PID4579 — прежний `node packages/app-expo/scripts/serve-import-audit-fixtures.mjs`, loopback8099. GET `/`200; `/stall.epub` в коде отдаёт первые2байта и закрывает соединение через90s. Проверка `/27-fresh-boundary.fbz` на этом сервере дала404 — это неподдерживаемый маршрут fixture, не ошибка приложения; для сценария использован только существующий `/stall.epub`.

## Выполненные шаги

Начальная попытка184525 не дошла до импорта: coordinate tap X10%,10% после settled controls не вернул Library. Отдельный **semantic Close**184623 успешно вернул Library. Поэтому общий блок ввода/ошибка закрытия не доказаны; первоначальный setup failure сохранён в Maestro, но не принят как продуктовый баг.

Основной единый flow: `/private/tmp/narra-air-import-toc.yaml`, артефакты `~/.maestro/tests/2026-09-05_184642/narra-air-import-toc`. Он использовал private вспомогательные flows `narra-air-ax3-before.yaml`, `narra-air-ax-stall-start.yaml`, `narra-air-ax3-cancel.yaml` из предыдущего принятого Library→Reader сценария.

| UTC | Действие / факт |
| --- | --- |
|15:46:56.035|Add URL `http://127.0.0.1:8099/stall.epub`|
|до15:47:08|Library own27+Downloading+Cancel assertions PASS; semantic tap own27; Reader Book actions+Cancel PASS|
|15:47:08.355–11.184|Book actions → semantic Table of Contents; sheet с заголовком и Close открыт|
|15:47:11–19|[Оглавление и видимый Cancel](evidence/ios-import-toc-2026-09-05/01-toc-visible-cancel-ax-absent.png). `when visible Cancel` SKIPPED, `when notVisible Cancel` выполнен и сохранил `toc-cancel-ax-absent.png`|
|15:47:19.082–21.485|Semantic Close закрыл TOC|
|15:47:21.7|[Reader после TOC: карточка видима](evidence/ios-import-toc-2026-09-05/02-reader-return-before-cancel.png), Cancel AX assertion PASS|
|15:47:21.773–23.114|Semantic Cancel, без координатного обхода|
|15:47:23.799|Cancel отсутствует, Reader остаётся открыт —27.8s от Add, до90s deadline|
|15:47:28.855|Inspector: exact p7 CFI/progress, две прежние книги; `lsof`8099 показывает только сервер LISTEN, соединения приложения нет|

[После отмены](evidence/ios-import-toc-2026-09-05/03-reader-cancelled.png). Финальная read-only SQLite проверка подтверждает own27 exactp7 и неизменную own30 `d9d5f55a-a220-4d9e-a85c-443212d1384e`, p1 `epubcfi(/6/2!/4/2[chapter-1],/2,/8/1:34)`, progress0.031068193886570464. Новых книг нет.

## Интерпретация дефекта

Expected: видимая кнопка отмены в оглавлении доступна тем же семантическим способом, что в Reader. Actual: карточка видима, но AX-поиск Cancel не находит её до закрытия sheet. Причину в host/modal ownership этим проходом не устанавливаем. Физическое нажатие Cancel внутри TOC намеренно не использовалось и не проверено; VoiceOver целиком не тестировался. Exit0 общего flow означает успешное завершение диагностической последовательности и cleanup, **не PASS доступности TOC**.

Баг передан root до исправлений. Новые UI действия остановлены. Отдельный уже известный дефект перекрытия текста loading-карточкой этим проходом не исправлялся.
