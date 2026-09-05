# iOS: зависший импорт → чтение → Cancel → повтор

Дата:2026-09-05, bounded gate18:02–18:07+0300. Только iPhone Air `984D0C64-C0B2-4204-92A9-2C65519089E8`, build36/fingerprint `b7e9985e4b5b…`, LOCAL18787/Metro8082. Прочитаны Expo native-data-fetching/dev-client skills. Все simulator actions через canonical wrapper; приложение, профили и TEST не менялись.

## Результат

**Чтение, физическое листание, Cancel, повтор без дубля и сохранение позиции прошли.** Есть отдельный P2 UX-дефект: постоянный loading toast перекрывает нижние строки Reader. Дополнительно воспроизведён accessibility-tree gap: видимая карточка книги исчезает из AX hierarchy при toast, хотя физический tap работает. Это ещё не полный VoiceOver тест и не доказательство конкретной причины в библиотеке toast.

## Подготовка и сохранность

- Read-only inspector подтвердил LOCAL, две собственные книги, own27 на p3. Online SQLite backup: `/private/tmp/narra-air-before-stall.9hXQhf/readany.db`.
- Source own27 и `/private/tmp/narra-audit-import-fixtures/27-fresh-boundary.fbz` побайтно совпали: SHA256 `e8c0288c81ed16c26ac22affc8ab02b95a22cd8ab5481ed626caf95a77cf79f8`. Поэтому повтор разрешён без изменения редакции.
- Existing loopback8099/serverPID4579 проверен: `/stall.epub` HTTP200,2bytes, затем зависание. Сервер ограничивает соединение90s; новый сервер не создавался. Existing8089 отдаёт own27 HTTP200/2199B.
- Два начальных fast tap по X не дали возврата в Library. Standalone tap после settled controls прошёл; сетевой запрос в этих setup attempts ещё не начинался. Следующие flows ждут видимости/окончания анимации. Это не принимается как доказанный сломанный backpath.

## Фактическая последовательность

| UTC | Действие / результат |
| --- | --- |
|15:05:07|Add from link→8099/stall.epub→Add; виден Downloading/Cancel|
|15:05:08|AX tap по названию own27 не находит элемент; screenshot показывает его. Saved failed hierarchy содержит Downloading/Cancel, но не название книги|
|15:05:53|Физический tap видимой own27 (75%,40%) открыл Reader при ещё активной загрузке|
|15:05:56–15:05:59|Два tap95%,50% перевели p3→p5; на screenshot одновременно p5 и Downloading/Cancel|
|15:06:00|Actual tap Cancel;15:06:02 AX уже не видит Cancel, screenshot без toast. Это раньше90s server cutoff, не самопроизвольный timeout|
|15:06:04|Inspector: own27 p5, CFI `epubcfi(/6/2!/4/2[chapter-1],/22/1:324,/28/1:183)`, progress0.15534096943285233|
|18:07 local|Library→Add from link→тот же own27FBZ: **Library updated, Added0/updated1/skipped0/failed0**, без Open; tap карточки вернул Reader|
|15:07:19|Inspector+readonlySQL: две книги, sameown27ID/hash/CFIp5; own30 неизменна. Это132s после старта/79s послеCancel — дальше потенциального90s завершения старого запроса|

Начальный CFI p3 был `epubcfi(/6/2!/4/2[chapter-1],/12/1:251,/18/1:113)`. После отмены и повторного импорта p5 сохранился точно. Нет phantom-книги, позднего сообщения успеха/ошибки старого запроса, сброса прогресса или новой карточки. В captured logs нет `Cannot create a view`; новых crash reports нет.

## Открытые UX/a11y риски

1. **P2: toast перекрывает читаемый текст.** Downloading/Cancel остаётся поверх нижних строк всё время загрузки; физические жесты работают, но часть страницы закрыта. Ожидается компактный неблокирующий статус с доступной отменой и без перекрытия текста. Root получил evidence до любых исправлений; frontend не менялся.
2. **AX gap, severity требует отдельного VoiceOver контроля.** При видимой карточке failed hierarchy не содержит её имени, semantic tap не работает, coordinate tap работает. Не маскировать этот разрыв физическим tap в accessibility-приёмке. Independent reviewer изучает lifecycle/modal/accessibility flags.

Артефакты: [loading Library](evidence/ios-stalled-import-2026-09-05/01-library-loading.png), [p5 во время загрузки](evidence/ios-stalled-import-2026-09-05/02-reader-loading.png), [послеCancel](evidence/ios-stalled-import-2026-09-05/03-reader-cancelled.png), [Updated1/Added0](evidence/ios-stalled-import-2026-09-05/04-repeat-summary.png), [final Reader](evidence/ios-stalled-import-2026-09-05/05-final-reader.png), [sanitized state](evidence/ios-stalled-import-2026-09-05/state.json).

Actual Maestro artifacts: `180453/narra-air-stall-read` (AX failure), `180547/narra-air-stall-physical-read-cancel` (PASS), `180645/narra-air-stall-repeat` (PASS), под `~/.maestro/tests/2026-09-05_…`. Raw logs/hierarchies не помещены в репозиторий. Проверка не включает отмену уже начатого atomic commit, успешный Ficbook/AI, cloud providers или длительный soak. Air оставлен на собственной книге27/p5; дальнейших UI действий не выполнялось.

## AX candidate: Library исправлена, полный путь пока не принят

После stable JS candidate `ToasterOverlayWrapper` с `unstable_accessibilityContainerViewIsModal=false` выполнен только canonical strict LOCAL run, без native rebuild. В одном actual hierarchy `/private/tmp/narra-air-ax-fixed-loading-hierarchy.txt` одновременно присутствуют own27, Downloading и Cancel. Семантические assertions и **tap по названию книги без coordinate workaround** проходят. Это подтверждённое исправление исходного library AX gap.

Однако полный gate **FAILED**: после появления Reader controls AX видит Book actions, но перестаёт видеть Cancel/Downloading, хотя screenshot показывает оба элемента. В первом раздельном прогоне поздний screenshot уже содержал сетевую ошибку — этот прогон не засчитан как Cancel. Повтор одним быстрым flow подтвердил независимый от timeout дефект: Add15:12:56.016 UTC, Cancel assertion15:13:05.524 (всего9.5s позже) FAILED; concurrent [кадр06](evidence/ios-stalled-import-2026-09-05/06-ax-reader-cancel-visible-but-unreachable.png) показывает Downloading/Cancel. Failed hierarchy `2026-09-05_181233/narra-air-ax-combined/screen-hierarchy/step-028-assertCondition-Cancel.json`: Book actions=true, Cancel=false, Downloading=false. Полный raw hierarchy не скопирован в repo.

Root и независимый автор получили новый blocker **до исправления**. Для завершения активной загрузки использован физический tap27%,86%; это cleanup, **не AX acceptance**. Planned page tap и semantic Cancel из этого flow не исполнялись после failed assertion. Final15:14:07 UTC: по-прежнему две собственные книги, own27 exactCFIp5/progress0.15534096943285233 без изменений. Вывод: Library+semantic book-open PASS, Reader-controls+Cancel совместная AX-доступность FAIL; toast placement остаётся отдельным известным UX-дефектом. Новые device actions остановлены до следующего stable GO.

## Candidate2 modal-local host: Cancel пока не принят

Первый проход18:18–18:19 пересёкся с Fast Refresh: failed screenshot содержит синий `Refreshing…`; он исключён из чистой приёмки. Root подтвердил недавние test-harness writes и повторно заморозил все mobile writes. Нативных rebuild не было.

Чистый повтор `2026-09-05_182053/narra-air-ax2`: Add15:21:08.913 UTC → Library assertions own27+Downloading+Cancel PASS → **semantic tap own27 PASS** → Reader Book actions+Cancel assertions PASS → page tap p6→p7 → **semantic Cancel15:21:19.917 UTC** → notVisible Cancel10s **FAILED**. Важное исправление интерпретации: [кадр07 ДО Cancel](evidence/ios-stalled-import-2026-09-05/07-ax2-reader-controls-and-cancel.png) показывает Reader controls, но toast **уже визуально отсутствует**. Успешный AX assertion не доказывает визуальную доступность кнопки. [Failed кадр08](evidence/ios-stalled-import-2026-09-05/08-ax2-invisible-cancel-failed.png) также без toast и без Refreshing, но failed hierarchy содержит enabled Cancel с bounds `[76,771][152,805]`. Нельзя утверждать, что toast исчез вследствие нажатия.

Отдельный **свежий** wrapper hierarchy после ошибки (`/private/tmp/narra-ax2-stable-after-hierarchy.txt`) тоже содержит Downloading и Cancel — это не только сохранённый snapshot. Read-only `lsof` одновременно показал established socket NarraPID7292:56494 ↔ localhost8099. Ни completed semantic tap, ни визуально отсутствующая карточка **не доказывают abort**; Cancel не принят. Root подтвердил, что PID7292 стартовал18:20:35 после стабильного candidate2, поэтому старый процесс до HMR исключён. В15:26:40 свежий hierarchy уже не содержал Downloading/Cancel, а root ранее прочитал пустой toast store. Это поздняя очистка, не доказательство пользовательской отмены; постоянный native ghost при пустом store этим не подтверждён.

Final15:21:37 UTC: две книги, own27 p7CFI `epubcfi(/6/2!/4/2[chapter-1],/34/1:35,/38/1:252)`, progress0.21747735720599323; own30 неизменна. Координатных обходов для book/Cancel в этом gate не было. Повторы остановлены; existing fixture сам ограничивает stalled connection90s. Narrow candidate2 **NOT ACCEPTED**, хотя совместная AX-видимость до Cancel улучшилась.

## Candidate3: видимая и семантически доступная отмена — PASS

Проверен frozen JS candidate с полноэкранным `box-none` слоем локального Reader host, без native rebuild и без изменений TEST. Первый проход183001 доказал видимую карточку и совместные AX assertions, но завершился ошибкой **QA screenshot path** (Maestro запрещает абсолютный путь). Отдельный процесс отмены183053 застрял до первого действия на XCTest driver status check; остановлен только собственный Maestro PID19273, exit143. Этот проход не засчитывается как отмена.

Чистый combined flow `2026-09-05_183226/narra-air-ax3-combined` завершился exit0. Все времена ниже UTC:

| Событие | Время / результат |
| --- | --- |
| Add stalled URL | 15:32:42.911 |
| Library: own27 + Downloading + Cancel в AX; semantic tap own27 | PASS |
| Reader: Book actions + Cancel в AX; карточка действительно видима | [Кадр09 до Cancel](evidence/ios-stalled-import-2026-09-05/09-ax3-visible-reader-cancel.png), лично просмотрен QA и передан root |
| Semantic Cancel | 15:32:53.331–54.852, без координатного обхода |
| Cancel отсутствует в AX | 15:32:55.452, через12.5s после Add, не90s timeout |
| Reader без карточки | [Кадр10 после Cancel](evidence/ios-stalled-import-2026-09-05/10-ax3-reader-cancelled.png) |
| Inspector + сокеты | 15:33:00.934:2books, own27 exact p7; `lsof`8099 показывает только сервер LISTEN, без established соединения приложения |
| Независимый root inspector | 15:33:15.132: route Reader, фактический sonner store `toasts=[]`, также до deadline |

Read-only SQLite подтверждает: own27 `44da976d-50a6-4dd8-95e7-208dbeacc4cf`, exact CFI `epubcfi(/6/2!/4/2[chapter-1],/34/1:35,/38/1:252)`, progress0.21747735720599323; own30 ID/CFI/progress неизменны. Новых книг нет. В отличие от candidate2, здесь есть визуальное подтверждение **до** действия, семантическая отмена, быстрое исчезновение и закрытое соединение до timeout.

Воспроизводимый объединённый flow: [.maestro/ios-air-stalled-import-ax.yaml](../../.maestro/ios-air-stalled-import-ax.yaml). Узкая приёмка касается только Library→Reader и отмены загрузки; другие native modals, полный VoiceOver проход и перекрытие нижнего текста карточкой остаются непроверенными/открытыми. После gate новые UI действия не выполнялись.
