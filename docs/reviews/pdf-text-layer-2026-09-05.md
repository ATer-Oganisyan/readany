# PDF: двойной текст и масштаб выделения

## Подтверждено до исправления

В [iOS before](evidence/ios-2026-09-05/pdf-double-text-before.png) видны два
разных по размеру и позиции слоя одной страницы. Счётчик и resume работали,
но это не означало пригодность PDF для чтения. PNG-страницы CBZ из того же
оригинального PDF отображались нормально.

В `packages/foliate-js/pdf.js` найдены две причины:

1. `.textLayer :is(span, br)` задавал обычный `color: transparent`.
   Общий reader `applyDocStyles` задаёт `span { color: inherit !important }`;
   поэтому слой выделения становился видимым поверх уже нарисованного canvas.
2. Фактически установленный для foliate PDF.js **4.10.38** использует
   `--scale-factor` для размеров TextLayer и шрифта. Adapter задавал только
   `--total-scale-factor` (используемое более новой версией). В корне
   монорепозитория отдельно установлен PDF.js 5.5.207; проверка только его
   исходников дала бы неверный ответ о runtime foliate.

## Изменение

Только PDF module: прозрачный цвет слоя теперь `!important` с более точным
селектором; `--scale-factor` и `--total-scale-factor` получают тот же zoom × DPR,
что canvas viewport. Удалена ошибочная незавершённая CSS-строка; WebKit text
autosizing отключён. Текстовый слой не скрывается через display/opacity и не
теряет pointer events, то есть выделение не отключено ради исчезновения дубля.
Первое изменение не затрагивало template. Нативная проверка выделения выявила
ещё один конфликт, устранённый отдельным узким guard ниже; стили EPUB сохранены.

## Проверки и ограничения

Production `render()` исполняется в тесте с подставленным TextLayer boundary.
При DPR 1/2/3 отсутствующий scale воспроизвёл **3 RED → 3 GREEN**; каждый тест
проверяет повторные zoom 1/0.5/1.5, canvas dimensions и scale, переданный слою.
Четвёртый CSS contract test — дополнительная проверка исходника, **не**
доказательство браузерной геометрии или выделения. Все четыре проходят.

Команда: `pnpm --filter @readany/app-expo exec vitest run src/lib/reader/pdf-text-layer.test.ts`.

Android WebView `getComputedStyle`/bounds before-after и настоящий iOS
screenshot AFTER проверены ниже. Совпадение CSS-variable с viewport само по себе
не доказывает пиксельную точность выделения каждого PDF/шрифта и не заменяет
native проверку.

## Нативный результат

- **iOS AFTER — прошло.** Основной агент выполнил сценарий и независимый
  reviewer просмотрел [снимок четвёртой страницы](evidence/ios-2026-09-05/pdf-resume-fourth-page-after.png): теперь один чистый слой текста,
  второй смещённый слой отсутствует. Переход 4 → 5 → 4 → закрыть → открыть снова
  вернул четвёртую страницу. Прогон Maestro:
  `2026-09-05_015419 / iOS PDF readable text layer and exact fourth-page restore`.
  [Одиночный слой после изменения](evidence/ios-2026-09-05/pdf-single-text-layer-after.png)
  сохранён также в [iOS platform report](ios-native-qa-2026-09-05.md). Это положительный
  результат данного PDF, не полная матрица шрифтов/форматов.
- **Android BEFORE — измерено.** У видимой страницы canvas имел
  412.19 × 583.24 CSS px, textLayer — 157.02 × 586.17 CSS px;
  `--scale-factor` пустой, `--total-scale-factor=1.818487`;
  span color `rgba(17,17,17,0.8)`, computed font size 16 px вместо разрешённого
  inline calc. Эти native данные подтверждают обе причины, не только исходник.
  Android AFTER первого исправления подтвердил alpha 0 и точное совпадение
  canvas/textLayer 412.19 × 583.24 CSS px, но **не прошёл проверку выделения**:
  у видимого span computed font-size оставался 16 px, высота около 1.22 px.
  Общий `applySettings` продолжал навязывать PDF шрифт/line-height читалки через
  `!important`. Поэтому single-layer readability не была выдана за selection PASS.

PDF asset первого исправления (iOS readability PASS, до typography guard): SHA256
`b74f4669fd14fd023a0b2bb8812fbaa6d66abf2a3b108d9a4daa0dcb81ea1f23`.

## Остаточный конфликт reflow typography

PDF `renderPage` теперь помечает свой HTML `data-readany-pdf`. Единственный
общий helper `syncReaderOverrideStylesForDoc` не устанавливает в такой документ
reflow stylesheet и удаляет его прежний экземпляр, если он уже есть. PDF.js
сохраняет собственные font size/family/line-height и позиции; обычный EPUB
по-прежнему получает последнее пользовательское значение.

Три новых RED → GREEN: marker в реально сгенерированном HTML, отсутствие
первой установки overrides на PDF, удаление прежних overrides. Четвёртый
negative control подтверждает обновление overrides для обычного EPUB.
Итого PDF **8 PASS**, вместе с open-race/page-count/Profile — **25 PASS**.
**Native Android FINAL AFTER — прошло.** У видимого span computed font-size
160.027 px, строка 253.36 × 7.62 CSS px; canvas и textLayer совпадают
412.19 × 583.24 CSS px, прежний `reader_overrides` отсутствует. Настоящий
long-press выделил слово `diary` ровно поверх слова, с нативными handles;
двойного текста нет, CFI `/6/6` сохранился. Независимый reviewer просмотрел
[снимок выделения](evidence/android-2026-09-05/pdf-selection-after.png).
[Computed geometry](evidence/android-2026-09-05/pdf-text-after.json) и
[результат выделения](evidence/android-2026-09-05/pdf-selection-after.json)
сохранены. Это визуальная и интерактивная приёмка данного PDF; полная матрица
PDF-шрифтов, сканов и сложной вёрстки не заявляется.

Guard прошёл независимый review reader-agent: alternative `renderer.setStyles`
не обходит его у FixedLayout; слой остаётся selectable. Финальный артефакт
с typography guard: PDF SHA256
`2ac034b257a653b095253d1b98d6d4431888f9ceeca37918c29f14c8a5702750`,
reader HTML SHA256
`5617d892f7c12a9b53c04a0c63051ac08cec61cb103d693a71ebb29543811a61`.
