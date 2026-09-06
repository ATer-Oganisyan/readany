# Android: меню действий над выделенным текстом

## Воспроизведение

На собственных QA EPUB и PDF Android показывал маркеры выделения текста, но
не показывал Add note / Copy / Translate / Summarize. В `applyDocStyles`
reader template общий capture-обработчик `contextmenu` вызывал `preventDefault`
и `stopPropagation` независимо от платформы.

Android QA выполнил согласованный изолированный native A/B на собственном EPUB:
временный window-capture обработчик останавливал доставку к document-listener,
не отменяя default action. `defaultPrevented` изменился с true на false;
физический long-press после этого открыл настоящее меню действий. Снимок:
`/private/tmp/narra-audit-android-epub-contextmenu-after.png`.
Это доказательство причины и кандидата, а не само по себе приёмка установленного
нового reader asset. Временный handler должен быть удалён перед финальным AFTER.
В том же A/B физический Add note открыл ManualNote собственной QA-книги;
сохранение не выполнялось. После возвращения в Reader диагностический handler
полностью удалён, CFI сохранился.

## Ограниченное исправление

`applyDocStyles` не добавляет подавляющий `contextmenu` listener на Android UA,
поэтому WebView может открыть существующий native selection ActionMode.
iOS и неизвестная платформа сохраняют прежнее подавление. Флаг документа
предотвращает накопление одинаковых iOS listeners при повторном применении темы.
Selection bridge, ReaderScreen, native ActionMode, CSS и зависимости не менялись.

## Проверки

`reader-native-selection-menu.test.ts` исполняет настоящий `applyDocStyles`
из template и отправляет cancelable `Event` через настоящий `EventTarget`.
DOM-порты стилей изолированы; проверка не сводится к поиску строки в исходнике.

До исправления: **3 RED / 2 PASS** — Android default action отменён, повторное
применение стилей также оставляет отмену, iOS накапливает пять listeners.
После: **5 PASS** — Android dispatch разрешён и не останавливается; iOS
по-прежнему отменяет событие, но только одним listener; неизвестный UA сохраняет
прежнее поведение.

С соседними selection/CFI/PDF/context suites: **6 suites / 69 PASS**.
App TypeScript, Biome нового теста и `git diff --check` PASS.

Root независимо проверил ветки платформ и actual event tests. После его GO
reader asset собран официальным Node 24; post-build набор — **4 suites / 28 PASS**.
SHA256 HTML: `c15fdf45c7c5b3291fd8da925d81d909543c90be0e8408dafb2356bdb1134830`.
MD5 HTML для сопоставления installed asset: `6cb2e202bf7ae3cc9fc11a22c753e04d`.
Runtime заморожен до нового подтверждённого дефекта.

Нативный AFTER без временного handler, включая PDF → Add note → возврат к
странице, ожидает отдельного Android QA этой сборки. Приёмка iOS-меню на новой
сборке не заменяется unit control, хотя его ветка отмены события не изменена.
