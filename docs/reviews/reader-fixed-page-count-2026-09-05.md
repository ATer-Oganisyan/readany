# Реальные номера страниц PDF и комиксов

## Воспроизведение

Android native QA на оригинальных fixtures подтвердил:

- Четырёхстраничный CBZ: последняя картинка `river-04.png`, CFI `/6/8`,
  fraction=1, но заголовок показывал `p. 185 of 247`.
- Двенадцатистраничный PDF: на видимой `Page 4 / 12`, CFI `/6/8`,
  fraction=1/3, заголовок показывал `p. 3 of 8`.

Foliate `SectionProgress` оценивает текстовые locations по размеру секций.
Для fixed-layout секции содержат изображения, поэтому их байты превращались
в вымышленные страницы и могли попадать в статистику прочитанных символов.

## Исправление

Relocate bridge явно передаёт тип fixed-layout и физическую страницу:
`renderer.index + 1` из `book.sections.length`. Оценочные byte locations
не отправляются для fixed-layout. Заголовок использует реальные страницы,
статистика — переходы между страницами, не байты изображений. Дополнительная
защита в ReaderScreen игнорирует byte locations при fixed-layout даже вместе
с ранее закешированным числом текстовых символов.

Расчёт reflowable locations, fraction и сохранённые CFI не менялись.
Исходные секции/адреса текста не перестраиваются.

## Поведенческие проверки

`src/lib/reader/reader-fixed-page-count.test.ts` выполняет настоящие методы
template relocate, Foliate `SectionProgress` и начало ReaderScreen `onRelocate`.
До исправления: 4 RED (первая/последняя, restore без generic section, ошибочная
статистика); 2 negative/control PASS. После исправления: 8/8 PASS, включая
12-страничный PDF, stale byte locations и cached metrics, reflow negative,
отсутствие начисления чтения при восстановлении позиции.

Из `packages/app-expo`:

```sh
pnpm exec vitest run src/lib/reader/reader-fixed-page-count.test.ts src/lib/reader/fixed-layout-lifecycle.test.ts src/lib/reader/reader-open-race.test.ts src/lib/reader/reader-progress.test.ts src/lib/narra/scene-square-contract.test.ts src/lib/narra/scene-suggestion.test.ts
pnpm exec tsc --noEmit
pnpm run build:reader
```

Результат: 53/53 PASS, TypeScript PASS, reader asset build PASS.
Biome нового теста/bridge PASS. Полный ReaderScreen lint содержит существующие
предупреждения/ошибки вне изменённых counter/cover hunks; это не объявляется
полностью зелёным lint экрана.

Reader HTML SHA-256 после сборки:
`823a3980a5238b32514269b88840f799f055fccb58b9811977aecaf767f3428c`.

Нативное подтверждение нового заголовка 1…4 / 1…12 и повторного открытия
ожидается отдельно от unit-проверок. Предшествующие native paging/resume
подтвердили правильные CFI/картинки, но не исправленный счётчик.
