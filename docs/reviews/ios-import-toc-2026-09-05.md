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

## TOC-local host candidate: NOT ACCEPTED (freeze19:02:26)

После stable GO выполнен canonical fresh process без native rebuild. Планировались две приёмки: Cancel непосредственно внутри TOC и отдельный TOC→Reader handoff. Первый flow остановлен на новом AX blocker, второй импорт **не запускался**.

- `2026-09-05_190325/narra-air-toc-fix-cancel`, Add16:03:41.322 UTC; semantic TOC16:03:53.664–56.550; title assertion FAILED16:04:14.055. [Кадр04](evidence/ios-import-toc-2026-09-05/04-candidate-toc-whole-ax-absent.png) показывает полноценное оглавление, его строки и Cancel. Но failed hierarchy `step-029-assertCondition-Table_of_Contents.json` не содержит ни заголовка, ни строк TOC, ни Downloading/Cancel; доступен underlying Reader. Ранний успешный Close assertion поэтому не доказывает доступность Close именно sheet.
- Свежий canonical hierarchy `/private/tmp/narra-toc-fix-failed-fresh-hierarchy.txt` подтвердил то же состояние; NarraPID56651 ещё имел established соединение8099. Root read-only CDP независимо подтвердил активный route `ReaderTOC-NzT0chGXbp33nYusy1_NS`.
- Никакой Cancel не исполнялся. К16:05:04 соединение уже закрылось само. После исчезновения toast свежий hierarchy `/private/tmp/narra-toc-fix-after-request-hierarchy.txt`16:05:25 (более103s послеAdd) всё ещё не содержит TOC; screenshot `/private/tmp/narra-toc-fix-after-request.png` показывает sheet без toast. Это **не успешная пользовательская отмена** и не только короткая анимация перехода.

По согласованию с root проведён один дополнительный контроль **без импорта** на том же frozen candidate: canonical cold launch→Library→own27→Book actions→Table of Contents. Flow `2026-09-05_190609/narra-air-toc-no-import` тоже FAILED title AX assertion после actual open и ожидания анимации. [Кадр05](evidence/ios-import-toc-2026-09-05/05-candidate-no-import-toc-ax-absent.png) показывает оглавление без уведомления; сохранённое дерево `step-013-assertCondition-Table_of_Contents.json` не представляет его заголовок. Проверки строк и нажатие Close после failed assertion не выполнялись. Таким образом, blocker воспроизводится без активного импорта и не требует передачи toast между экранами. Конкретная причина пока не установлена; candidate нельзя принимать по одному визуальному виду.

Final inspector16:06:53.195 UTC и read-only SQLite: две прежние книги, own27 exact p7 CFI/progress без изменений, own30 неизменна. Никаких координатных обходов Cancel, reset или изменений TEST. UI оставлен на открытом TOC; новые действия остановлены, source edits не выполнялись. Историческая узкая приёмка Library→Reader остаётся отдельной от проваленной приёмки этого candidate.

## Контролируемое сравнение: дефект нельзя приписать только candidate

По отдельным GO root выполнены ещё два **no-import** холодных прогона тем же `/private/tmp/narra-air-toc-no-import.yaml`. Во всех четырёх сравнениях экран визуально отображается, но title AX assertion не проходит; строки/Close после него не исполняются.

| Вариант | Maestro run | Результат |
| --- | --- | --- |
| TOC-local candidate + stalled import |190325|Title/строки/Cancel отсутствуют в AX; отсутствие sheet в свежем дереве сохраняется и после завершения запроса|
| Тот же candidate, холодный запуск без импорта |190609|Title AX FAIL; [кадр05](evidence/ios-import-toc-2026-09-05/05-candidate-no-import-toc-ax-absent.png)|
| Diagnostic A: только локальный TOC toast subtree удалён, ownerTOC оставлен; freeze19:08:51 |190922|Title AX FAIL; [кадр06](evidence/ios-import-toc-2026-09-05/06-diagnostic-a-no-import.png)|
| Исходные четыре mobile-файла точно восстановлены автором до HEAD695dcb1; freeze19:10:48 |191122|Title AX FAIL; [кадр07](evidence/ios-import-toc-2026-09-05/07-original-baseline-no-import.png)|

Артефакты двух контролей: `~/.maestro/tests/2026-09-05_190922/narra-air-toc-no-import` и `~/.maestro/tests/2026-09-05_191122/narra-air-toc-no-import`; каждый содержит `takeScreenshot/toc-no-import-before-ax.png` и `screen-hierarchy/step-013-assertCondition-Table_of_Contents.json`. Поиск в обоих failed деревьях не находит Table of Contents, Свет в мастерской, Последняя переправа. Screenshot каждого лично просмотрен: все эти элементы визуально на месте.

**Вывод:** удаление локального toast subtree само по себе не устраняет проблему; воспроизведение на восстановленном исходном baseline не позволяет назвать её регрессией именно нового TOC candidate. Возможный общий native/automation/modal контекст требует отдельной диагностики; игнорировать failed AX gate или принимать физический tap за семантическую доступность нельзя. Ни diagnostic A, ни неуспешный candidate не являются принятым shipping-решением.

Последний inspector16:12:06.446 UTC: прежние2books, own27 exactp7 `epubcfi(/6/2!/4/2[chapter-1],/34/1:35,/38/1:252)`, progress0.21747735720599323; own30progress0.031068193886570464. После контролей импорта, Cancel, навигации по строкам, reset или дополнительных UI действий не было. Финально открыт TOC исходного baseline.

## Диагностика высоты sheet: expanded AX PASS, обратный цикл не проверен

На неизменном исходном runtime и уже открытом TOC сохранены `/private/tmp/narra-toc-detent-before.png` и свежий `/private/tmp/narra-toc-detent-before-hierarchy.txt`. Canonical check подтвердил Xcode26.5, pasteboard0, build36, current native fingerprint. Его строка профиля отражала default shell TEST/8081, поскольку check вызван без launch overrides; приложение не перезапускалось и endpoint не менялся. Отдельный correct-Air inspector16:14:24.080 подтвердил фактический LOCAL18787 development/installation.

Разрешённый root **диагностический** swipe за область ручки `(50%,50%)→(50%,20%)`, duration600ms,16:14:34.255–36.020 UTC действительно увеличил sheet до большого detent. Flow `2026-09-05_191428/narra-air-toc-detent` exit0: title Table of Contents и обе строки Свет в мастерской/Последняя переправа появились в AX; semantic Close16:14:36.912–38.577 закрыл TOC. [Кадр08 expanded](evidence/ios-import-toc-2026-09-05/08-expanded-detent-ax-pass.png) лично просмотрен. Inspector16:14:50.808: exactp7 и2books неизменны. Это подтверждает зависимость наблюдаемой AX-доступности от detent/перехода, но **не заменяет приёмку исходного half-sheet** и не является полным VoiceOver тестом.

По следующему GO подготовлен цикл reopen→half→expand→contract→semanticClose без импорта и без cold restart. Он не дошёл до TOC: первая private YAML попытка отклонена parser из-за дробного9.4% (никаких UI действий), затем `191534` завершился на Book actions. Единственный bounded retry `191623` добавил ожидание settled controls и5s assertion, но также FAILED до открытия TOC. Снимок показывает Readerp7 без toolbar после center tap; причина не установлена, дополнительные попытки/restart не выполнялись. Поэтому изменение AX **после обратного уменьшения панели не проверено**, нельзя выводить, что причина только в размере, а не в уведомлении о переходе.

Final inspector16:16:52.803: own27 exactp7/progress0.21747735720599323, own30 unchanged,2books. Устройство оставлено на Reader; действий с TEST/импортом/исходниками не было.

## A/B фильтра снимка Maestro: диагностический PASS, не VoiceOver acceptance

По отдельному разрешению root создан только private `/private/tmp/narra-air-snapshot-diagnostic-config.yaml`:

```yaml
platform:
  ios:
    snapshotKeyHonorModalViews: false
```

Поддержка `--config` проверена по установленному Maestro help; canonical wrapper передаёт параметры через `maestro ... test "$@"`. Глобальная и репозиторная конфигурация не менялись. После canonical fresh LOCAL launch исполнен **тот же** no-import flow с `test-ios --config=/private/tmp/narra-air-snapshot-diagnostic-config.yaml /private/tmp/narra-air-toc-no-import.yaml`.

Run `2026-09-05_191751/narra-air-toc-no-import` exit0: видимый half-sheet остался того же размера, title и обе строки теперь находятся семантически, semantic Close действительно возвращает Reader. [Кадр09](evidence/ios-import-toc-2026-09-05/09-private-snapshot-filter-disabled.png) лично просмотрен. В actual XCTest log `~/.maestro/tests/2026-09-05_191751/xctest_runner_2026-09-05_191752.log:6` записано `snapshotKeyHonorModalViews configured to value: false`, следующая строка сообщает отключение фильтра для показа элементов позади модальных окон. Это подтверждает применение настройки, а не только запись YAML.

Результат локализует существенную зависимость наблюдаемого дерева от фильтра Maestro/XCTest. Однако расширенное дерево может включать недоступные фоновые элементы; **данный PASS не доказывает корректность VoiceOver, не закрывает исходный AX-дефект и не разрешает использовать настройку как молчаливый обход в приёмочных тестах**. Кнопка Close здесь сверена с видимым sheet и фактическим переходом. Final inspector16:18:18.142 UTC: exactp7,2books, LOCAL18787 unchanged. После этого UI остановлен; импорт/исходники/настройки TEST не затрагивались.

## Финальный функциональный контроль отмены внутри TOC — PASS с явной диагностической настройкой

По отдельному GO выполнен один canonical cold launch исходного runtime, затем `/private/tmp/narra-air-toc-fix-cancel.yaml` с той же **private** настройкой snapshotfalse. Это только функциональный touch/cancel gate, не приёмка стандартного AX или VoiceOver. СерверPID4579 и90s cutoff проверены до старта; никаких source/global config изменений.

Run `2026-09-05_191923/narra-air-toc-fix-cancel`, exit0:

| UTC | Факт |
| --- | --- |
|16:19:39.780|Add stalledURL|
|до16:19:55|Semantic own27→Reader→TOC, title+Downloading+Cancel найдены; [кадр10](evidence/ios-import-toc-2026-09-05/10-functional-visible-toc-cancel.png) лично подтверждает видимую кнопку именно при открытом TOC|
|16:19:55.731–57.012|Semantic tap Cancel, без coordinate workaround|
|16:19:57.749|Cancel отсутствует, через18s отAdd, не90s timeout; [кадр11](evidence/ios-import-toc-2026-09-05/11-functional-toc-cancelled.png) показывает TOC без карточки|
|16:19:57.820–59.574|Semantic Close→Reader|
|16:20:00.340|Cancel/Downloading не появились повторно в Reader|
|16:20:06.859|Inspector exactp7/2books, `lsof`8099 только серверLISTEN — соединения приложения нет|

Actual driver log `logs/device-xctest.log`16:19:28.396 подтверждает `snapshotKeyHonorModalViews configured to value: false`. Следовательно исходная сборка функционально умеет отменить импорт при открытом TOC; прежний failure нельзя объявлять доказанным физически неработающим Cancel. Стандартный filtered AX/VoiceOver остаётся отдельным нерешённым вопросом. Own27 exactCFI/progress и own30 не изменились; новых книг нет. После завершения дополнительных UI действий не выполнялось.

Независимое root CDP подтверждение16:20:41.463 UTC (ещё до90s отAdd): routeReader, `toasts=[]`, `mountedChannels.default=1`.

После диагностики выполнен ровно один canonical `hierarchy` **без `--config`**, без нажатий и перезапуска приложения; exit0, результат `/private/tmp/narra-air-normal-hierarchy-after-diagnostic.txt`. В `~/.maestro/tests/2026-09-05_192108/maestro.log:30` драйвер запускается с `snapshotKeyHonorModalViews=null`; actual `xctest_runner_2026-09-05_192109.log:6`16:21:12.923 подтверждает `configured to value: (null)`. Таким образом диагностическое переопределение не оставлено в текущем runner для следующего QA. Глобальные конфигурации не менялись.
