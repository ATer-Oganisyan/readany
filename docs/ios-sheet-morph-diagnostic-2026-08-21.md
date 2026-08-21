# Диагностика iOS sheet → Chat morph — 21.08.2026

## Что проверено

Окружение: iPhone 17 Pro Simulator, iOS 27.0, Xcode 27 beta.

1. Fixed medium form-sheet + `UIViewController.Transition.zoom`.
2. Fixed large form-sheet + тот же Zoom.
3. Dynamic medium → large через `UISheetPresentationController.animateChanges`, с очисткой Zoom перед resize и немедленной установкой нового Zoom после возврата `animateChanges`.
4. Реальная Debug-сборка Narra после текущих изменений.
5. Временное отключение `usePreventRemove` в Metro-сборке; после теста исходное условие восстановлено.

Пробники:

- `docs/probes/fixed-sheet-zoom-probe.swift`
- `docs/probes/dynamic-detent-zoom-probe.swift`
- `docs/probes/sheet-detent-viewwilltransition-probe.swift`

## Подтверждённые результаты

### 1. Ни medium, ни large сами по себе не ломают Zoom

Оба fixed-detent сценария закрываются одним непрерывным morph в кнопку. Нет предварительного sheet-slide, клиппинга низа, двойной кнопки или однокадрового reveal.

Следствие: дефект Narra не является общим багом `large` form-sheet на iOS 27.

### 2. Немедленный re-arm после `animateChanges` в чистом UIKit работает

Dynamic-пробник выполнил:

```swift
controller.preferredTransition = nil
sheet.animateChanges { sheet.selectedDetentIdentifier = .large }
installZoom(on: controller)
```

`animateChanges` синхронно вернул финальные bounds `(402 × 812)`. И resize medium → large, и последующий интерактивный dismiss были визуально чистыми. Provider на dismiss вернул живой source (`window=true`, `hidden=false`, `alpha=1`).

Следствие: отчёт `ios-sheet-morph-review-2026-08-21.md` верно доказывает, что `viewWillTransition` не приходит, но гипотеза «сам немедленный re-arm обязательно сплайсит анимации» в чистом UIKit опровергнута. Искать обязательный completion через таймер/KVO/CATransaction пока не нужно.

### 3. `usePreventRemove` нельзя оставлять в финальной архитектуре

Он намеренно отменяет исходный интерактивный dismiss, возвращает контент к списку/medium и запускает новый программный pop. Поэтому закрытие диалога одним непрерывным жестом принципиально невозможно. Это отдельная причина текущего UX-дефекта, независимо от geometry bug.

### 4. Однокадровая кнопка — симптом разорванного transition

В чистых пробниках source всё время остаётся смонтированным и его model-state не меняется, но UIKit корректно перекрывает его transition-слоями. В Narra кнопка появляется после того, как системный snapshot/overlay уже исчез, потому что sheet-slide и Zoom не сходятся в одну траекторию. Поэтому принудительно анимировать opacity кнопки поверх UIKit — маскировка, а не лечение.

## Что теперь наиболее вероятно

Дефект находится в интеграции `RNSScreen` + смена React-контента + lifecycle `preferredTransition`, а не в базовом UIKit Zoom:

- список закрывается нормально, потому что surface и detent стабильны;
- диалог меняет одновременно контент и detent;
- ручные detent-смены проходят мимо модуля;
- same-detent путь не создаёт свежий Zoom;
- двухфазный JS-dismiss добавляет второй transition и гарантированно убивает непрерывность жеста.

## Следующий минимальный эксперимент в Narra

1. Удалить `usePreventRemove` и всю prepare-dismiss state machine.
2. Удалить мёртвый `SheetResizeObserverViewController`; после программного `animateChanges` ставить свежий Zoom синхронно, как в прошедшем UIKit-пробнике.
3. На every-detent-change (включая ручной) инвалидировать и заново ставить Zoom; same-detent запрос тоже должен форсировать refresh.
4. Не ждать resize-промисом перед навигационным pop и не менять диалог обратно на список при dismiss.
5. Проверить на реальном Narra: 10 медленных + 10 быстрых закрытий из списка и диалога, отдельно ручное medium/large, iOS 27 и iOS 26.

Если после этого чистый direct dialog-dismiss всё ещё клиппится только внутри `RNSScreen`, следующий A/B — один фиксированный large detent в самом route Narra. Если он чистый, проблема остаётся в RNS detent lifecycle; если нет — в RNS/Zoom integration или source-host, а не в UIKit sheet как таковом.

