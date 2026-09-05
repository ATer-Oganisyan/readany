# Возврат из заметок: один Reader и повторяемый CFI

## Подтверждённые дефекты

На iOS финальный PDF note-return иногда оставался на p.5 вместо p.4.
Повторное физическое нажатие прошло, но read-only native navigation snapshot
показал более определённый дефект: `Tabs → Reader A → Notes A → Reader B →
Notes B → Reader C`, все Reader относятся к одной PDF. Android независимо
наблюдал тот же рост стека. Это не доказательство, что накопление экранов
исчерпывающе объясняет каждое неправильное начальное положение.

Настоящий `openMobileBook` вызывал `navigate('Reader')`. У установленного
StackRouter без `getId`/`pop` этот вызов с Notes сверху добавляет Reader.
Поведенческий тест исполняет именно production open-helper и установленный
StackRouter: пять циклов дали **6 Reader + 5 Notes**, вместо одного Reader.

Отдельный actual mounted Reader test показал: первый CFI обрабатывается,
`setParams` очищает его, пользователь листает дальше, но повторный запрос к
тому же CFI игнорируется `lastNavigatedCfiRef` до смены книги. Этот дефект
важен при корректном возврате к уже смонтированному Reader, но сам по себе
не объясняет сбой в новосозданном Reader с новым ref. Два теста были RED.

## Ограниченное исправление

- Open-helper после прежних проверок файла/скачивания ищет последний Reader
  с точным bookId в актуальном navigation state. `POP_TO` с `source` этого
  route key и `target` stack key сохраняет этот Reader, снимая экраны над ним.
  Это не перенос Reader наверх с оставшимися Notes под ним и не подмена
  другой книги. Если matching Reader нет, прежний navigate открывает новый.
- После очистки route CFI сбрасывается только защита обработанного запроса.
  Повтор того же адреса разрешён; пока запрос не очищен, обычный rerender или
  смена ready/loading не отправляют повторный переход.
- Импортные проверки, picker, storage и reader asset не менялись.

Root независимо прочитал установленную реализацию POP_TO до runtime edits
и согласовал эти два изменения. Последующий diff передан reader reviewer.

## Проверки

Три genuine RED → **18 PASS** в `open-mobile-book.test.ts` и
`reader-route-cfi.test.tsx`. Контроли: пять циклов сохраняют Reader key,
Close оставляет Tabs; interleaved A→B→Notes→openA возвращает key A, не
превращает B в A; открытая другая книга не переписывается; текущий Reader
не дублируется; cold/global открытие сохраняет Tabs; запрос ждёт готовности.
Прежние fault/import tests в этом наборе сохранены. App TypeScript — exit 0,
Biome трёх изменённых library/test файлов — PASS, diff-check — PASS.

Нативный AFTER на iOS принят ниже; Android также прошёл 3 цикла на `d90…`
с одним и тем же Reader key и Close→Tabs. Гонка начального CFI отдельно
исправлена в [ready-contract](initial-reader-ready-2026-09-05.md), а не этим
изменением стека. Финальный полный прогон — **155 suites / 1402 mobile PASS**.
## Native AFTER: iOS

На cold-loaded JS после исправления пройдены **3 физических цикла**
PDF page 4 → page 5 → Notes → сохранённая заметка → page 4.
Read-only Hermes snapshots после первого и третьего циклов показывают один
и тот же `Reader-FRMFYqlhZYj4CLMfyGFBQ`, stack `Tabs → Reader`, без Notes.
Финальный CFI — `epubcfi(/6/8)`. Отдельный Close вернул в Library;
после него в root stack только Tabs. Reader asset — `c15f…4830`.

Доказательства: [первый snapshot](evidence/ios-2026-09-05/note-return-stack-first-cycle-after.json),
[третий snapshot](evidence/ios-2026-09-05/note-return-stack-three-cycles-after.json),
[страница 4](evidence/ios-2026-09-05/pdf-three-note-returns-page-four-after.png),
[журнал трёх циклов](evidence/ios-2026-09-05/pdf-three-note-returns-after.log),
[stack после Close](evidence/ios-2026-09-05/note-return-close-tabs-after.json),
[Library](evidence/ios-2026-09-05/library-after-repeated-note-returns.png).
Это подтверждает повторный возврат в существующую читалку, но не закрывает
отдельный ready-contract при начальном открытии новой читалки из заметки.
