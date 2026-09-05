# Reader: готовность после завершения начального перехода

## Подтверждённая гонка

В iOS-проходе новая PDF-заметка содержала правильный CFI страницы 4, но один
переход Page 5 → Notes → заметка оставил страницу 5. Отдельно были исправлены
накопление Reader screens и lifetime-deduplication одинакового route CFI;
эти исправления не меняли порядок первоначальной загрузки.

Source review обнаружил другую гонку. `openBook` восстанавливает сохранённую
позицию книги через `await el.init(...)`. Template сообщал RN `loaded` уже на
первом `el.load`. В fixed layout этот сигнал идёт из `#createFrame` до разрешения
promise кадра; весь разворот и начальная навигация ещё могут быть не готовы.
RN после `loaded` выставляет `loading=false` и отправляет route-CFI заметки.
Этот переход мог конкурировать с ещё выполняющимся восстановлением страницы 5.
На fresh Reader route effect **не** запускается до самого `openBook`: исходно
`loading=true`; проблема именно в слишком раннем подтверждении готовности.

## Ограниченное исправление

- First-load обработчик по-прежнему сразу подключает жесты, selection и стили.
- `loaded` отправляется только после успешного завершения `init` либо его
  успешного fallback `goToFraction`, с проверкой актуального opening sequence.
- Один лимит **30 секунд** покрывает начальную навигацию вместе с fallback.
  Он не сбрасывается при переходе к fallback. Abort нового открытия немедленно
  освобождает старое ожидание.
- При ошибке opening помечается failed до закрытия собственного view. Поздние
  load/relocate callbacks игнорируются; error всё равно показывается. View
  новой книги не закрывается и не обнуляется.
- RN route-CFI effect не считает `loading=false` успехом при активной ошибке.
  Запрошенный адрес сохраняется до успешного Retry, затем обрабатывается один раз.

Лимит относится **только к init/fallback**, а не к полной загрузке файла,
сетевым запросам, парсингу всей книги или `el.open`. Новая гарантия общего
времени импорта/открытия не заявляется. Порядок источников `lastLocation` не
изменялся; оптимизация непосредственного первого открытия на route CFI сюда
не включена. Новых зависимостей и нативного кода нет.

## Поведенческие доказательства

До исправления реальные template `openBook` и mounted Reader route effect дали
**7 RED / 13 PASS**: ранний loaded для reflow/fixed; loaded до завершения fallback;
ложный loaded при двух ошибках; бесконечное ожидание init; stale initial loaded;
поглощение адреса заметки на ошибке.

После исправления и двух дополнительных budget/cancellation controls:
`reader-open-race.test.ts` **17 PASS**, `reader-route-cfi.test.tsx` **5 PASS**.
Тесты используют deferred начальную навигацию и настоящий template lifecycle,
проверяют синхронное подключение selection до готовности, ошибку через 30 секунд,
бюджет init 20s + fallback 10s, отсутствие timers после отмены, поздние resolve,
reject и relocate без изменения Retry/нового view. Route test сохраняет pending
CFI при ошибке и потребляет его только после успешного восстановления.

Соседний набор — **7 suites / 68 PASS**, app TypeScript/Biome/diff-check PASS.
Root независимо проверил diff и разрешил сборку. Post-build — **4 suites / 36 PASS**.
Отдельный независимый финальный прогон root — **5 suites / 47 PASS**.

Полный mobile-прогон выявил один устаревший source-only контракт, требовавший
`markLoaded` прямо в первом `load`. Его заменили исполнением настоящего load
listener с никогда не завершающимся `doc.fonts.ready`: без microtask или timer
должны подключиться selection/long-press/стили, а настоящий touch сразу попасть
в gesture handler. Готовность после init проверяется отдельно, как описано выше.
Обновлённый interaction suite вместе с open/route — **3 suites / 49 PASS**;
app TypeScript, Biome и diff-check снова PASS. Runtime и собранный asset при
этой корректировке теста не менялись.

Reader HTML SHA256:
`d90aa52a86faaf117ad70df54e4d993ffca9e8d61bc3a8b7f5914139c6f81159`.
MD5: `23ce9e242d852241404f5a5b7d5c299d`.
PDF engine SHA256 не изменён:
`2ac034b257a653b095253d1b98d6d4431888f9ceeca37918c29f14c8a5702750`.

Нативная проверка fresh initial navigation на iOS описана ниже с точным
разграничением тестового вызова и пользовательских нажатий. Успешные ранние
PDF note loops на предыдущих reader assets остаются историческими проверками,
но не подменяют приёмку этого ready-contract изменения.
## Native AFTER: d90 на iOS

На установленном reader `d90aa52a86faaf117ad70df54e4d993ffca9e8d61bc3a8b7f5914139c6f81159`
своя PDF была физически переведена на страницу 5 и закрыта. Root stack
содержал только Tabs. Затем QA-скрипт вызвал настоящий `openMobileBook`
с адресом сохранённой заметки со страницы 4. Никакой записи SQLite или
подмены завершения renderer не выполнялось. Это **управляемый тестовый
вызов навигации через инспектор, не физический вход из общего блокнота**:
в существующем UI общий блокнот открывает редактор заметки.

Новая читалка показала страницу 4; отдельный последующий физический loop
4→5→Notes→та же note→4 прошёл. Read-only финальный snapshot подтверждает
`epubcfi(/6/8)`, один Reader и отсутствие закрытых FullScreenNotes.

Доказательства: [запрос и исходная позиция](evidence/ios-2026-09-05/fresh-note-request-trigger.json),
[исходный stack](evidence/ios-2026-09-05/fresh-note-request-before-state.json),
[страница 4](evidence/ios-2026-09-05/fresh-note-request-page-four-after.png),
[финальный UI-возврат](evidence/ios-2026-09-05/final-reader-note-return-page-four.png),
[финальный state](evidence/ios-2026-09-05/fresh-note-request-after-state.json).
