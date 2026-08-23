# Системный Zoom шторки персонажей на iOS

Экран персонажей на всех поддерживаемых версиях iOS открывается как системная `formSheet` с двумя detents: 55% для списка и 100% для чата. На iOS 26 и новее UIKit дополнительно превращает нижнюю кнопку «Персонажи» в шторку через системный Zoom transition. На iOS 16.4–25 та же шторка открывается без Zoom.

## Архитектура

- `ReadAnyReaderToolbar` — обычный `UIToolbar`. Кнопки «Слушать» и «Персонажи» создаются один раз как `UIBarButtonItem`; их системные `UIButton.Configuration` показывают image+title без собственных фонов и размеров. Состояние TTS не меняет identity item.
- Кнопка «Персонажи» регистрируется по `charactersSheetSourceId`, перед нажатием помечает следующий destination и остаётся смонтированной под шторкой.
- Patch `react-native-screens` синхронно уведомляет bridge о готовом form-sheet controller непосредственно перед `presentViewController`. На iOS 26 bridge в этот момент назначает `preferredTransition = .zoom(options: nil, sourceBarButtonItemProvider:)`, то есть до начала presentation.
- Невидимый `SystemSheetZoomDestinationView` внутри `RNSScreen` хранит декларативные `{ sourceId, expanded }`: повторно связывает источник для последующего dismiss и управляет выбранным detent независимо от Zoom.
- UIKit полностью управляет presentation, интерактивным dismiss, отменой жеста, геометрией, затемнением и Reduce Motion системного перехода. Кастомные `ZoomOptions` и gesture callbacks не используются.
- Prop `expanded` независимо выбирает первый или последний detent через `UISheetPresentationController.animateChanges`. Смена detent не снимает и не переустанавливает Zoom.
- React Native отвечает только за содержимое уже открытой шторки. Список и чат меняются crossfade-анимацией 120/180 мс; при Reduce Motion crossfade выполняется без длительности.

## Платформы

- iOS 26+: `formSheet` + системный Zoom из `UIBarButtonItem`.
- iOS 16.4–25: обычная системная `formSheet` с теми же detents.
- Android: прежняя навигация отдельным экраном.

Основа реализации: [WWDC25 — Build a UIKit app with the new design](https://developer.apple.com/videos/play/wwdc2025/284/?time=847) и [UIViewController.Transition.zoom](https://developer.apple.com/documentation/uikit/uiviewcontroller/transition/zoom(options:sourcebarbuttonitemprovider:)).
