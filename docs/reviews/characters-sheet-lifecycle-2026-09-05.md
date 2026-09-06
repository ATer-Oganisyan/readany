# Characters sheet: переходы и доступность — 5 сентября 2026

## Результат и границы вывода

В настоящем `NarraCharactersScreen` воспроизведён и исправлен дефект lifecycle:
после потерянного/прерванного callback перехода оба слоя могли навсегда остаться
с `pointerEvents="none"`, `accessibilityElementsHidden=true` и
`importantForAccessibility="no-hide-descendants"`. В StrictMode cleanup оставлял
`mountedRef=false`, поэтому даже успешная анимация не снимала React transition flag.

Это **не доказывает причину отдельного native наблюдения**: при свежем открытии
Characters видны заголовок и Retry, но Maestro hierarchy перечисляет только
фоновый reader. Контрольный mounted тест первого открытия проходит **до**
исправления: list активен, Retry вызывается, анимации не запускаются. Если экран
действительно смонтирован заново и переход в чат/обратно ещё не происходил,
причину нужно искать отдельно на уровне native presentation/AX snapshot.

Исходные native свидетельства корневого агента:

- `evidence/ios-2026-09-05/characters-localized-retry-after.png`: видимый EN error
  и Retry внутри шторки приблизительно на 55% высоты.
- `/private/tmp/narra-audit-ios-retry-current-hierarchy.json`: отсутствуют Retry
  и содержимое показанной шторки; Characters относится к кнопке фонового reader.
- Два `tapOn Retry` закончились timeout. Координатный tap не доказал отсутствие
  обработчика: быстрый 502 мог не дать заметного spinner.

Нативным устройством во время этой диагностики управлял только root.

## Воспроизведение до исправления

`characters-sheet-transition.test.tsx` монтирует экспортированный production
screen через React test renderer. Подменены native Animated/rAF и внешние
сервисы; исполняются настоящие hooks, handlers, state и accessibility props.
Это не проверки строк исходника и не native E2E.

Первые семь сценариев дали **5 RED, 2 PASS**:

| Сценарий | Наблюдение до исправления |
| --- | --- |
| Первый mount Characters при недоступном backend | PASS: list/Retry доступны, 0 анимаций |
| Обычный список → чат → список | PASS |
| Animation callback `{ finished: false }` | Переход не завершён, список недоступен, чат не открыт |
| Animation callback не доставлен | То же бесконечное состояние |
| rAF после fade-out не доставлен | Чат смонтирован, но pointer/AX остаются выключены |
| Обратный переход без callback | Список не становится доступным |
| StrictMode setup → cleanup → setup | Чат виден, но transition flag не сброшен |

## Изменение

Дизайн, detents, native zoom и используемый Animated API сохранены. Добавлен
один watchdog на весь переход: **600 ms** при работающем JS event loop. Он
останавливает анимации, выставляет окончательные opacity/целевой content,
снимает interaction/AX lock и очищает timer/rAF. Обычная анимация завершается
раньше и сама отменяет watchdog. Пока JS-поток приостановлен, timer также не
может исполниться; это не гарантия wall-clock latency в фоне.

Каждый переход имеет generation; старые native/rAF callbacks после завершения,
другого перехода или unmount ничего не меняют. Teardown очищает timer/frame и
останавливает animation. Setup снова устанавливает `mountedRef=true`.

Дополнительно проверены late completion после watchdog и возврата в список,
completion после unmount, Reduce Motion без остаточного overlay/timer и граница
599/600 ms с окончательной opacity. Итог: **11/11 lifecycle PASS**, вместе с
существующими Characters unavailable/status tests **31 PASS**.
Независимый агент reader_fixes прочитал lifecycle diff и повторил **31/31 PASS**,
новых блокеров не нашёл. App `tsc --noEmit`, Biome и diff-check — без ошибок.

```sh
pnpm --filter @readany/app-expo exec vitest run \
  src/lib/narra/characters-sheet-transition.test.tsx \
  src/lib/narra/characters-unavailable.test.tsx \
  src/lib/narra/characters-status-contract.test.ts
```

## Что ещё проверить на iOS

Без входа в чат растянуть freshly opened Characters за grabber до полного
detent и снова снять hierarchy. Этот жест не вызывает JS `showChat`/
`showCharacters`. Возврат Retry в AX после такого жеста будет отдельным
свидетельством native sheet/инструментального поведения, не исправления JS gate.

Затем проверить список → чат → назад при реальном interrupted transition,
повторное открытие, Retry и VoiceOver. Native A/B остаётся за пределами локального
mounted результата; не отмечать его успешным по наличию патча или screenshot
без доступного действия.
