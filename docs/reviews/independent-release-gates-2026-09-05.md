# Независимая карта оставшихся условий приёмки

Снимок после полного final-v5 прогона 5 сентября 2026, 13:43. Это независимый
review, **не разрешение на production-релиз**. Актуальная сводка кампании:
[результаты и платформенные ограничения](release-campaign-2026-09-05.md).
Проверенный final-v5 reader HTML SHA256:
`d90aa52a86faaf117ad70df54e4d993ffca9e8d61bc3a8b7f5914139c6f81159`.

Предыдущие native этапы остаются привязаны к своим сборкам: ZIP/context
`6baef5c2…`, scene availability `c11f24dc…`, TOC continuity `9667fc81…`,
PDF page anchor `8a06cd1a…`, iOS повторные Notes → Reader `c15fdf45…`.
Их результаты не следует выдавать за полный повтор всех native сценариев
на последнем asset. Финальные Android повторные переходы/тема и production
exports на этом снимке ещё выполняются; последующие результаты — в сводке кампании.

## Что ещё нельзя объявить завершённым

| Условие | Что уже доказано | Остаточная проверка / ограничение |
| --- | --- | --- |
| Полный AI success loop | Локальные PG/MinIO pipeline, terminal error/retry, tenant/quota tests; native failure UI и возврат к чтению | TEST API наблюдался с HTTP 502. Нет live import→analysis→scene→character answer с настоящим провайдером; нет оценки качества/скорости разметки на эталонном корпусе |
| Финальный installed reader | PDF/CBZ отображение, выбор слова и fixed-layout counter/resume приняты на обеих платформах. Rich EPUB iOS: контекст совпал с видимыми границами, CFI прежний. Android EPUB Range: 12 настоящих 206, 74 023 bytes из 1 719 918 bytes, без fallback. Disabled scene slots не появились в Android 10-turn/reopen и iOS chapter-boundary AFTER | Native сохранённое scene image отдельно не покрыто пустым fixture. Широкая PDF/font/layout матрица не пройдена; успех одной сложной EPUB не означает отсутствие всех спойлеров |
| PDF: слово → заметка → возврат | iOS на `8a06cd1a…`: `diary`, SQLite `epubcfi(/6/8)`, физическая цепочка 4→5→Notes→note→4. После обнаруженных duplicate Reader routes на `c15f…` физически пройдены три повторных возврата и Close: тот же Reader key, один Reader, закрытых Notes в stack нет | Точность до страницы, не диапазона слова. Финальные Android три цикла на `d90…` ещё завершаются. Initial saved p.5 → requested p.4 на iOS `d90…` подтверждён контролируемым native helper trigger, **не** физическим переходом из global Profile Notes: этот экран открывает редактор по дизайну |
| Возврат к системной теме | Доказана обратная связь PanelUI → Uniwind → Appearance: после Dark → System поле сохраняло System, но палитра оставалась dark. Actual provider/bridge/native Uniwind: два RED → семь PASS, OS flips и явные override проверены | Физический Dark → System без перезапуска на обеих платформах ещё завершается. Успешное закрытие picker/надпись System само по себе не доказывает восстановление системной палитры |
| iOS немедленное завершение после новой позиции | JSON/SQLite conflict, backward CFI, backend metadata identity и сериализация покрыты; Android durable checkpoint/force-stop выполнен. Новый iOS опыт на текстовой FBZ: `simctl terminate` через 704.95 ms после наблюдения нового CFI, завершение через 855.85 ms; холодное открытие восстановило точный новый CFI, читаемый screenshot независимо просмотрен | Это один целевой process-termination, не SIGKILL и не задержка от физического tap. Старый опыт на collapsed scene-only CFI отдельно не принят как восстановление текстовой страницы; не смешивать его 700.4/847.7 ms с успешным новым опытом |
| Доступность действий уведомления / sheet | Counts и локализованные Details безопасны; URL Cancel и повторный ввод приняты на обеих платформах; sheet lifecycle bounded. Android строгий OCR→physical Details tap прошёл с существующим RN Pressable, экспериментальный Sonner patch не устанавливался | iOS half-detent TOC/Retry видны, но VoiceOver/native accessibility не доказана Maestro hierarchy; interrupted animation fix не объясняет initial TOC. Settings использует другой SwiftUI presenter, поэтому его успешный AX не изолирует влияние высоты sheet |
| Все каналы импорта / cloud | Native local formats, mixed reimport, URL fixtures обе платформы. Library CBZ repair принят на Android и iOS: прежние ID/hash/CFI, iOS p.3/4 и 20→20 записей после одиночного wildcard picker. Реальный Expo transport timeout/retry/cancel обе платформы; iOS redirect/новая редакция сохранены раздельно, source/stored SHA совпадают | Нет полного account WebDAV/S3 sync, live Ficbook import, live backend catalog success. Отдельные Notes/Profile repair не выполнены. Неактивный WebDAV browser не считать доступной проверенной функцией |
| Целевая сборка и эксплуатация | Final-v5 Node 24: mobile 155 suites / 1402 PASS, core 81 / 656 PASS; неизменённый backend 807 PASS с реальными PG/S3. Всего 2865, без skip. App/core обычный `tsc --noEmit`, campaign actionlint и diff-check — exit 0; Linux ARM64 image smoke пройден | Новый GitHub Actions job ещё не запускался; production exports под последним asset на этом снимке ожидаются. Нет подписанного store/release mobile artifact и полного deployment PG/S3/backup restore drill. ReaderScreen lint: baseline и current по 35 errors + 3 warnings с одинаковым multiset диагностик, **не lint PASS** |
| Тысячи клиентов и большие библиотеки | Short SQL concurrency без дублей/quota нарушений; ingress ограничен; Profile/native render reduction; пять small-book циклов без роста числа WebViews | Один gateway writer — обязательное ограничение, не horizontal scale. Нет длительного mixed load/owner fairness/провайдерных p95,p99/RSS/cost. Debug Android footprint около 1 GiB PSS не оправдывается пятью циклами; нужен release/реальный слабый телефон и большие книги |

Обнаруженный native TOC-gap закрыт на сборке `9667…`: iOS FBZ chapter 3 → 1
раньше пропускал chapter 2 (`0→2` в bridge); новый холодный forward попал
в chapter 2, а холодный TOC3→prev — в её конец. Android новый FBZ до fix
имел frames `[0,2]`, после fix `[0]`; 12 next прошли `[1,2]`, 12 prev
вернули исходные CFI/текст, 12 ускоренных next дали тот же результат, что
медленный проход. Traces обеих платформ независимо прочитаны. Retention и
поздний preload имеют 2 + 3 behavioral RED → 9 PASS; geometry во время
отдельного iframe `view.load()` не покрыта исчерпывающе. Подробности:
[TOC chapter continuity](toc-chapter-continuity-2026-09-05.md).
Notes routing/Close/Cancel и layout теперь имеют native AFTER: iOS две новые
QA-записи с правильным SQLite book_id, Keep editing/Discard, Close и непустой
список ниже native header; Android empty CTA → Add → второй Add → Edit
сохранили ровно две записи, другая книга пуста, возврат сохранил CFI/текст.
Отказы/задержки SQLite проверены поведенчески, без поломки пользовательской БД.
Swipe-dismiss и новый durable draft journal не заявлены.
Независимый review дополнительно воспроизвёл поздний INSERT A → load B →
публикацию заметки A в Reader B с одинаковым CFI. Store теперь ограничивает
публикацию активной книгой и поколением загрузки, Reader отдельно фильтрует
все свои annotation consumers по bookId. Core suite этих исправлений —
11 PASS; actual mounted Reader дал 3 RED → 4 GREEN, совместно с ManualNote и
Notes routing — 32 PASS на том промежуточном этапе. Эти проверки и последующие
same-frame draft guards включены в final-v5; локальные числа не прибавляются
к общему прогону. Cross-book issue относится к книгам одного пользователя,
не к подтверждённой межаккаунтной утечке.

Известные сохранённые trade-offs: unknown-length source upload списывает полный
максимальный размер попытки; global journal/quota не distributed; старые cloud
MD5/raw SHA256/base64 SHA256 не мигрированы; cross-UUID title recovery намеренно
fail-closed; COW старые artifacts сохраняются, bounded GC ещё нет. При final
storage failure остановленная статистика сессии логируется, но не имеет нового
durable journal. Это не те же данные, что CFI checkpoint.

## Проверенные числа и запрет неверных выводов

- Последний независимый полный core: **81 suites, 656 PASS, 0 skip**,
  Node 24.20.0, 13:40:23, 3.41 s, exit 0;
  [полный журнал](evidence/core-final.log), источник
  `/private/tmp/narra-audit-core-final-v5.log`.
- Полный root mobile: **155 suites, 1402 PASS, 0 skip**, Node 24.20.0,
  13:43:15, 4.04 s, exit 0; [полный журнал](evidence/mobile-final.log).
  Независимо прочитан и скопирован
  `/private/tmp/narra-audit-mobile-final-v5-green.log`. TCP tests не исключены.
  Предыдущие checked-in журналы сохранены в
  `/private/tmp/narra-audit-{mobile,core}-before-final-v5.log`.
  **1287/645**, **1345/656**, **1368/656**, **1377/656** и **1386/656** —
  исторические снимки, не дополнительные тесты. С неизменённым backend
  **807** общий итог **2865**. Длительность Vitest не является временем
  пользовательского сценария или измерением production capacity.
- Оба обычных `tsc --noEmit` на final-v5, `actionlint` для gateway/regression
  workflows и `git diff --check` завершились exit 0. Пустые успешные журналы
  сохранены как `/private/tmp/narra-audit-{app-tsc,core-tsc,workflows,diff}-final-v5.log`.
- [ReaderScreen lint comparison](evidence/reader-lint-baseline-comparison.json):
  файл baseline проверен против git blob `8d9d6bb`, конфигурация/версия Biome
  одинаковы, `--max-diagnostics=none`. Baseline/current: **35 errors + 3 warnings**,
  оба exit 1, multiset category/severity/message совпадает, added/removed пусты.
  Это отсутствие новых диагностик в этом файле, не доказательство отсутствия
  любых stale-dependency bugs и не зелёный repo-wide lint.
- Удалён только `baseUrl` из core tsconfig; относительные `paths` не менялись.
  Обычный `pnpm --filter @readany/core exec tsc --noEmit` на Node 24 проходит
  **без** ignoreDeprecations. Четыре compiler/alias tests проверяют отсутствие
  option diagnostics, основной alias, вложенный alias и external package.
- ZIP/open: **22 PASS**, до исправления первый набор дал **8 RED / 3 PASS**.
  Фактический ZIP-parser прочитал выбранные XML/главу из архива с 2 MiB unused
  member, запросив менее 4 KiB. Это не время native cold-open.
  Installed Android AFTER независимо подтверждён network JSON: 12 Range-ответов,
  74 023 bytes, без fallback. Это не универсальная доля экономии и не latency.
- iOS process-termination helper: **12 fake tests PASS**; последний guard-gap
  disconnect перед сроком воспроизведён RED→GREEN. Ни один тест не подключается
  к Simulator и не завершает настоящий процесс.
  Реальный успешный текстовый опыт отдельно подтверждён
  [termination log](evidence/ios-2026-09-05/text-checkpoint-termination.jsonl),
  [restored context](evidence/ios-2026-09-05/text-checkpoint-restored.json) и
  [читаемой страницей](evidence/ios-2026-09-05/text-checkpoint-restored.png).
- Profile-only native trace: hidden Profile/MiniHeatmap **4→0** обновлений,
  native commits **157→21** в сопоставимых ~5 s окнах. Это не процент улучшения
  пользовательской задержки; trace содержит dev/profiling overhead.
- SQL stress **192 requests→1 scene job/2 reservations**, 273 ms; другие 32
  запросов дали 12 admissions/20 quota rejects. **Не** «генерация за 273 ms» и
  не нагрузка тысяч production читателей.

## Исправленные расхождения документов

`import-acceptance` больше не показывает весь уже проверенный local/URL путь
как непроверенный; initial/final этапы и платформы разделены. Same-hash fixture
ожидает `updated`, не новый `added` и не фиктивный `skipped`. Kindle fixtures и
их реальное native открытие отражены без DRM/KFX обещаний.

В `backend-release-readiness`, `fixed-layout-acceptance` и `import-release-gates`
убраны устаревшие ожидания CBZ tap/TOC, PDF selection, URL Cancel и native Expo
transport AFTER; настоящий account sync остаётся открытым. S3 E2E обновлён до
двух реально прошедших тестов. Старые checkpoint counts оставлены как явно
исторические, не суммируются с новым полным прогоном.

Основные источники состояния: [iOS](ios-native-qa-2026-09-05.md),
[Android](android-native-qa-2026-09-05.md),
[backend](backend-release-readiness-2026-09-05.md),
[каналы импорта](import-release-gates-2026-09-05.md),
[rich context](reader-rich-context-2026-09-05.md),
[сессии](reading-session-reliability-2026-09-05.md),
[Notes → тот же Reader](notes-reader-navigation-2026-09-05.md),
[initial reader readiness](initial-reader-ready-2026-09-05.md),
[возврат к системной теме](system-theme-recovery-2026-09-05.md).
Отдельные подтверждения последнего native этапа:
[iOS PDF page anchor](evidence/ios-2026-09-05/pdf-note-page-anchor-after.json),
[iOS CBZ repair](evidence/ios-2026-09-05/cbz-repair-after.json),
[Android Notes SQLite](evidence/android-2026-09-05/notes-sqlite-edited.json).
Все подтверждения относятся к указанным fixtures/переходам; полная защита от
спойлеров, безусловное восстановление при kill в любой инструкции и отсутствие
утечек памяти не заявляются.
