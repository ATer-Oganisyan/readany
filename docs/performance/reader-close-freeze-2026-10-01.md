# Полное зависание ридера после повторного открытия

Исследуемый код: `b561ed0c` (TestFlight 1.4.0, build 114). 1 октября 2026.

## Текущий результат: отдельный crash при прокрутке после zoom

Пользователь уточнил, что после правки очереди фриз не повторялся, но
несколько раз завершалась именно development-сборка через Metro.

Следующее воспроизведение (PID 8801) остановлено **до падения** единственным
breakpoint `objc_exception_throw`. Пользователь начал прокручивать Popular.
Причина exception:

```text
Attempt to unmount a view which has a different index.
parent: RCTViewComponentView, tag=452, frame=(16, 0, 398, 4139.67)
child: ReadAnyNativeControls.SystemSheetZoomSourceView, tag=7134
index: 17, actual index: 18, tag at index: 7112
```

В `parent.subviews` обнаружен дополнительный **UIKit._UIReparentingView**
между карточками на индексе 11. Zoom source tag404 восстановлен на индексе
16, хотя по геометрии занимает место 11. Это непосредственное доказательство
рассогласования UIKit-иерархии и Fabric: React Native ожидает только карточки,
а UIKit перемещает живую обложку и добавляет собственный служебный элемент.
Окно виртуализации при прокрутке удаляет невидимые карточки и обнаруживает
неверный индекс. Safe-area update — один из путей запуска транзакции,
не установленная причина изменения порядка.

Локальные доказательства:
`/tmp/narra-zoom-grid-exception-subviews.txt`,
`/tmp/narra-zoom-grid-exception-stack.txt`,
`/tmp/narra-before-assert-capture.png`.
После сохранения данных breakpoint удалён, отладчик отключён.

Исправление находится в общем `SystemSheetZoomSourceView`: дочерние React
элементы монтируются внутри обычного `UIView`, и именно он становится
source для UIKit zoom. Внешний ExpoView остаётся в своём месте в списке.
Регистрация source, callback возврата тени и восстановление clipping остаются
на внешней обёртке. Так меняется общий компонент для Popular, My books,
поиска, категорий и мини-плеера, без обходов в отдельных экранах.

Основание — изоляция source в
[официальном Expo Router 57.0.14](https://github.com/expo/expo/blob/391d762fa5059cebf63ef2381da93994ce97fc63/packages/expo-router/ios/LinkPreview/LinkZoomTransition.swift#L189-L217).
Перенаправление mount/unmount во внутренний UIKit-контейнер уже используется
установленным Expo GlassContainer. Наш контейнер оборачивает всех детей,
поскольку мини-плеер имеет несколько элементов, а не один.

[RN #58686](https://github.com/react/react-native/pull/58686) предлагает общий
фикс учёта React children при добавлении UIKit siblings для hover. Он не
merged и имеет замечания review. Для Narra такая замена React Native не нужна:
изолируем наш источник zoom в месте, где возникает проблема.

Нативные Debug-сборки для физического iPhone и iOS 27 Simulator прошли,
установлены каноническим wrapper-скриптом. На Simulator после трёх открытий
и закрытий книги прокрутка Popular прошла через удаление старых карточек
и появление следующих без падения. Пользователь на новой физической сборке
сообщил: «стало лучше», затем «не лагает». Это положительная проверка Debug;
длительная проверка Release ещё не выполнена. TestFlight не обновлён.

`scripts/verify_zoom_source.py` прошёл на iOS 27 Simulator: через штатную
Expo-фабрику создаётся реальный source, затем имитируется найденная перестановка
UIKit и выполняется реальное удаление из `RCTViewComponentView`. Проверены
индексы соседей, размер внутреннего контейнера и удаление нескольких детей.
Это проверка механизма, а не полная автоматизация UIKit transition.
Также прошёл существующий `node scripts/verify-sheet-zoom-clipping.mjs`
(возврат, отмена перехода и отказ coordinator).

Во время подключения LLDB к новой физической сборке пользователь сообщил
«всё зависло». В этот момент процесс был остановлен самим attach (SIGSTOP).
Debugger сразу отключён, процесс продолжен. Это не новое воспроизведение
ошибки; последующая проверка телефона проходит без debugger.

## Сопоставление с документацией и Zoobr

В Narra уже используются штатные native-stack и native bottom tabs.
[React Navigation подтверждает](https://reactnavigation.org/docs/from-expo-router/)
их нативную реализацию и отдельно указывает отсутствие прямого аналога zoom.
Поэтому миграция всей навигации на Expo Router ради одного перехода не является
маленьким исправлением. [Expo Link.AppleZoom](https://docs.expo.dev/router/advanced/zoom-transition/)
требует Router Stack/Link и имеет собственные ограничения быстрых переходов,
headers и запрета interactive dismissal для modal.

Для длинного каталога стандартный путь —
[FlatList с ограниченным окном и лёгкими карточками](https://reactnative.dev/docs/0.86/optimizing-flatlist-configuration).
В Popular сейчас собственное окно `catalogGridWindow` внутри ScrollView/pager.
Оно ограничивает число карточек, но добавляет собственный расчёт геометрии.
Его можно заменить штатным списком отдельной задачей с проверкой большого
заголовка, свайпа Popular/My books и сохранения позиции. Простое удаление окна
вернёт прежнее накопление карточек. Текущий crash исправляется на границе
UIKit/Fabric независимо от выбора списка.

Проверена актуальная ветка Zoobr `mobile-kirilltarelkin`,
[commit 4aeaddc](https://github.com/sboo-create/zoobr/tree/4aeaddc0fc28300c5de951fc57fdc2f440a82c91),
а не старый `main` на SDK54:

- [Каталог](https://github.com/sboo-create/zoobr/blob/4aeaddc0fc28300c5de951fc57fdc2f440a82c91/src/CatalogScreen.tsx#L224)
  изолирует обложку через `View collapsable={false}` и использует FlatList.
  Это тот же полезный принцип изоляции, который теперь применён в общем
  native source Narra, включая мини-плеер с несколькими дочерними элементами.
- [Навигация](https://github.com/sboo-create/zoobr/blob/4aeaddc0fc28300c5de951fc57fdc2f440a82c91/src/navigation.tsx#L163)
  открывает курс обычным push с UIKit zoom; наш Reader — fullScreenModal.
  Замена меняет поведение экрана и требует отдельной проверки жестов.
- [Их zoom-код](https://github.com/sboo-create/zoobr/blob/4aeaddc0fc28300c5de951fc57fdc2f440a82c91/modules/zoobr-context-menu/ios/ZoobrContextMenuModule.swift#L1272)
  тоже собственный: registry, KVO, snapshot, таймер и повторный поиск coordinator.
  Копировать эти обходы целиком нет оснований. Сам Zoobr не запускался,
  отсутствие ошибок в нём этим исследованием не доказано.

Действительно лишнее в Narra: registry alignment targets (`alignToContent`
нигде не включён) и `pageSheet` detent `bookPreview` (такого presenter нет).
Они кандидаты удаления после стабилизации, а не доказанные причины лагов.
Expo 57.0.14 рекомендует screens ~4.26.0; у нас pin 4.25.2 с исключением из
Expo validation. В чистом npm 4.26.2 уже есть три группы наших backport:
Android bitmap, lifecycle bottom accessory и visibility через hidden.
После обновления их можно убрать; snapshot, очередь modal и iOS 27 UITab
патчи этим обновлением не заменяются.

[React Native рекомендует измерять скорость в Release](https://reactnative.dev/docs/0.86/performance).
Debug/Metro и особенно tracing-breakpoints не подходят для сравнения плавности,
но не объясняют найденный native crash: он повторялся и без подключённого LLDB.

## Повторная проверка: build 115 не устранил зависание

Пользователь подтвердил тот же сценарий на физическом iPhone с TestFlight
1.4.0 (115). Успешные 16 циклов на Simulator **не подтвердились на телефоне**.
В IPA 115 проверено наличие `addSnapshotToView` и отсутствие
`setViewToSnapshot`: upstream patch действительно попал в сборку.

После отключения Amiconnect-VPN CoreDevice снова получил доступ к iPhone по
проводу. Повторное включение воспроизводило ошибку 4016. По просьбе пользователя
VPN оставлен выключенным. Это причина недоступности диагностики, а не
установленная причина зависания Narra.

С текущего зависшего процесса 115 (PID 8507) без перезапуска получены:

- Снимок экрана: загруженная титульная страница «Преступления и наказания»,
  X остался визуально нажатым (`/tmp/narra-115-phone-frozen.png`).
- Журнал приложения (`/tmp/narra-115-phone-events.json`): после обоих открытий
  есть `reader_loaded`, затем `reader_closed` в 16:45:53.908 и 16:45:55.645 MSK.
  Событие пишется при размонтировании ReaderScreen, поэтому JS-обработчик
  закрытия уже сработал. Это не подтверждение завершения UIKit dismiss.
- Профиль Time Profiler за 5 секунд
  (`/tmp/narra-115-phone-name.trace`, экспорт
  `/tmp/narra-115-phone-time-profile.xml`): основной поток обслуживает run loop,
  display link, Core Animation и WebKit; JavaScript также получает время.
  Постоянная блокировка главного потока в обработчике X не наблюдается.
- Полный sysdiagnose с телефона от 15:43 относится к build **114**, а не 115.
  В нём основной и JS-потоки также обслуживают run loop. Архив сохранён локально
  в `/tmp/narra-phone-before115-sysdiagnose.tar.gz`.

Дополнительные 7 циклов Simulator с реальными координатными нажатиями прошли.
Через LLDB проверено, что Reader действительно использует
`_UIZoomViewControllerTransition`. Причина потери завершения перехода пока не
установлена; новый фикс на основании одного совпадающего симптома не внесён.

Похожий upstream [screens #4591](https://github.com/software-mansion/react-native-screens/issues/4591)
описывает потерю completion при одновременном dismiss из двух стеков.
В Reader вложенного native stack не обнаружено, поэтому применимость этого
механизма к Narra пока не подтверждена.

Для следующего воспроизведения на телефон отдельно установлена development
сборка (`com.mishanaer.readany.dev`, build 36) через канонический
`READANY_DEVICE_ID=314D48FD-AC59-590F-A1BB-261DD0D48C2D ./script/build_and_run.sh rebuild-ios`.
TestFlight 115 сохранён. LLDB подтвердил запрет attach к TestFlight, но успешно
подключился к development процессу. После подключения процесс продолжен.

Первый запуск dev-client показал ошибку разрешения `bottom-tabs/unstable`:
одновременно оставались два Metro из этой рабочей копии (LAN и localhost),
запущенные до обновления pnpm patch. Оба остановлены, через `start-lan` запущен
один Metro на текущем Wi-Fi. Модуль существует в установленном пакете; новый
сервер успешно собрал 4528 модулей и открыл библиотеку на телефоне.

## Трассировка физического iPhone: закрытие из completion открытия

Пользователь дважды воспроизвёл зависание в development-сборке с патчем 115.
Первое снято через LLDB с PID 8624: исходный `RNSModalScreen` сохранён, снимок
находится внутри него — #4407 применён корректно. При этом RNSScreen всё ещё
`disappearing`, `isBeingDismissed = YES`, `transitionCoordinator = nil`,
у стека `_updatingModals = YES`. UIKit zoom использует действительную обложку
в текущем окне. Сам снимок не является первопричиной: его корректное размещение
не завершило переход.

Во втором запуске (PID 8675) LLDB записывал вызовы dismiss, lifecycle экрана,
snapshot и recycling. `/tmp/narra-dismiss-calls.log` показывает две разные цепочки:

1. Первое закрытие запущено из обычной отложенной mounting transaction React.
   Затем пришёл `viewDidDisappear:` этого Reader: переход завершился.
2. При следующем открытии Reader размонтирован **до окончания presentation**.
   `_updatingModals` поставил обновление в очередь. После этого completion
   `presentViewController` вызвал `afterTransitions → updateContainer →
   setModalViewControllers → dismissViewControllerAnimated` синхронно,
   прямо под `UIPresentationController transitionDidFinish:` и
   `_UIViewControllerTransitionContext completeTransition:`.
   `viewWillDisappear:` нового Reader пришёл, `viewDidDisappear:` — нет.
   Пользователь подтвердил зависание.

Повторного dismiss той же книги и вызова `RNSScreenStackView prepareForRecycle`
в этой трассе нет. Механизм двух конкурирующих стеков из #4591 не подтверждается.
Времена между breakpoint не используются как метрика скорости: отладчик
замедляет выполнение. Доказательство здесь — порядок и вложенность вызовов.

Проверяемая правка: в существующем `afterTransitions` выполнять именно
отложенный `updateContainer` через main queue, после возврата из completion
UIKit. Это устраняет вложенный запуск следующего перехода; таймера и нового
состояния нет, zoom и хаптики сохраняются. Патч применён через `pnpm patch-commit`,
затем проверен на чистом npm-пакете 4.25.2; установленный RNSScreenStack.mm
совпадает с чисто применённым патчем. Physical Debug build прошёл и установлен.
Проверка на телефоне после этой правки ещё выполняется.

### Результат проверки очереди и отдельный вылет

После правки трасса `/tmp/narra-dismiss-calls-after.log` содержит шесть
вызовов dismiss, ни один не вложен в completion UIKit. Один вызов пришёл
из отложенной очереди. Это подтверждает изменение порядка вызовов, но само
по себе не доказывает устранение всех зависаний.

Во время этой проверки пользователь сообщил о лагах, зависании и ошибке.
Debug-процесс 8704 остановился на SIGABRT. После удаления breakpoints и detach
он завершился. Crash report `Narra-2026-10-01-170851.ips` сохранён локально как
`/tmp/narra-dev-170851.ips`. Это нельзя списывать на паузы отладчика:
последний exception проходит через `RCTViewComponentView.mm:191` — проверку
индекса удаляемого дочернего view. Цепочка идёт от прокрутки UIScrollView через
изменение safe area и синхронный `RNSSafeAreaViewComponentView updateState`
к Fabric mounting. Точный view и причина нарушения порядка ещё не установлены.
В Metro также был `GO_BACK was not handled`; это не доказательство причины
нативного падения.

Приложение перезапущено (PID 8751) **с тем же бинарником**, без breakpoint и
подключённого LLDB. Пользователь затем сообщил: «уже не фризится».
Это положительная проверка повторных открытий на физическом устройстве,
но отдельный SIGABRT пока не считается исправленным. После этого сообщения
новые патчи не добавлялись и новая TestFlight-сборка не публиковалась.

Повторная проверка crash logs после положительного сообщения обнаружила ещё
два SIGABRT с тем же методом unmount: PID 8751 в 17:12:33 и PID 8772 в 17:13:15.
Отчёты сохранены в `/tmp/narra-dev-171234.ips` и `/tmp/narra-dev-171316.ips`.
Они произошли без breakpoint-трассировки. Debug-процесса уже нет, TestFlight
8507 продолжает существовать. Уточняем, на какой сборке пользователь наблюдал
отсутствие фриза; вылеты нельзя объяснить подключённым отладчиком.

### Сверка с документацией и upstream

- [Expo: Zoom transition, known limitations](https://docs.expo.dev/router/advanced/zoom-transition/#known-limitations)
  прямо описывает задержку порядка секунды при быстрых open/close/open и
  связывает её с react-native-screens. Это объясняет известную задержку,
  но не доказывает причину бесконечного зависания Narra.
- [Expo #42797](https://github.com/expo/expo/issues/42797) остаётся открытым.
  [Предложенный PR screens #4711](https://github.com/software-mansion/react-native-screens/pull/4711)
  ещё не merged; он раньше уведомляет JS о нативном zoom pop. У нас X уже
  размонтирует Reader на стороне JS до окончания UIKit dismiss, поэтому
  переносить этот PR как решение нашего зависания оснований нет.
- [React Native 0.86: Performance](https://reactnative.dev/docs/0.86/performance)
  требует оценивать скорость в Release: Debug и диагностика ухудшают её.
  Это ограничение измерений, а не объяснение SIGABRT.
- Установлены Expo 57.0.14, RN 0.86.2, screens 4.25.2. Локальный
  `expo/bundledNativeModules.json` рекомендует screens `~4.26.0`; пакет
  сознательно исключён из Expo install validation. Разница версий — повод
  проверить совместимость, но не доказательство бага. В исходниках 4.26.0,
  4.27.0 и main синхронный safe-area update по-прежнему присутствует.
- [screens #4175](https://github.com/software-mansion/react-native-screens/issues/4175)
  имеет похожий safe-area путь, но другую конечную ошибку (props parser).
  Maintainers не подтвердили reproduction и возражают против общего
  отключения synchronous updates из-за видимых скачков интерфейса. Такой
  workaround в Narra не применён.
- [screens #4197](https://github.com/software-mansion/react-native-screens/issues/4197)
  описывает Fabric unmount crash с native tabs на iOS 27. Maintainers не
  воспроизвели его даже на присланном примере. Совпадение верхнего метода
  недостаточно, чтобы считать это установленной причиной нашего вылета.

### История и границы вывода

- Очередь с синхронным `updateContainer` присутствует в исходном
  react-native-screens 4.25.2, используемом с 2 августа (`21042f46c`).
  Наши прежние патчи эту часть не меняли.
- `410cbcfe` от 25 сентября подключил Reader к zoom обложки и сделал модальное
  окно способным к UIKit interactive transition. Это расширило использование
  соответствующего нативного перехода; само по себе не доказывает дату появления бага.
- `47759abd` того же дня менял clipping предков обложки на возврате. Трасса не
  показывает его как источник повторного dismiss.
- `b561ed0c` от 1 октября меняет виртуализацию Popular и хаптики; обработчик X
  получил только синхронный fire-and-forget `hapticLight`, без ожидания перед
  `onClosePress`. Нативную очередь модальных переходов этот commit не меняет.
- Пользователь допускает, что заметил дефект только сейчас. Без проверки старой
  сборки на том же iPhone утверждать, что сегодняшнее изменение создало или
  участило зависание, нельзя.

## Симптом и статус доказательств

Пользователь уточнил: достаточно примерно двух циклов открыть/закрыть **любую**
книгу; после нажатия X ридер зависает наглухо, кнопка остаётся нажатой.
Это отдельный сценарий от задержки возврата в Popular после длинной прокрутки.

После запуска iOS 27 пользователь воспроизвёл зависание в симуляторе.
**Подтверждён зависший нативный dismiss со снимком экрана поверх библиотеки**:
главный поток обслуживает run loop, JavaScript отвечает, но RNSScreen остаётся
в `disappearing`, а `_updatingModals = 1`. Замена `controller.view` снимком
наблюдается непосредственно. После переноса upstream исправления выполнены 16 успешных циклов открытия и
закрытия на том же iOS 27 Simulator. Исходный upstream issue описывает другой
порядок переходов; на физическом iPhone исправление пока не проверено.

## Снято с зависшего iOS 27 Simulator

Dev-client build 36, iPhone 17 Pro, simulator
`89DF38B4-5C83-4D6F-B622-1D22F7AE0AA5`, процесс 77733. Состояние исследовано
без перезапуска, в районе 15:46–15:50 MSK. LLDB временно останавливал процесс
для чтения, после диагностики отсоединён. UI и настройки перехода не изменялись.

- `sample` за 3 секунды: главный поток преимущественно ожидает события в
  `mach_msg2_trap`, также обрабатывает display link и WebKit. Блокирующего
  ожидания в обработчике X или бесконечного цикла не обнаружено.
- Оба Hermes runtime Narra на Metro ответили на `Runtime.evaluate`;
  очередь каталога не загружена (`pageRequests/pendingWrites/pendingBooks = 0`).
- `RNSScreen 0x172469e00` остаётся в состоянии `disappearing`.
- Его `view` — `_UIReplicantView 0x17a16dc00`, идентификатор
  `Snapshot of <RNSModalScreen: 0x17246c600>`; это последний верхний слой
  `UITransitionView`, покрывающий весь экран 402×874.
- Исходный `_initialView` — `RNSModalScreen 0x17246c600`, но он отсутствует
  в снятом дереве окна. Вместо него виден снимок с прежним состоянием кнопок.
- У корневого `RNSScreenStackView`: `_updatingModals = 1`,
  `_presentedModals = [RNSScreen 0x172469e00]`.
- У закрываемого контроллера `transitionCoordinator = nil`;
  `UIApplication.isIgnoringInteractionEvents = 0`.
- Предки библиотеки остаются в состоянии `appearing`.

Это объясняет неподвижный X: пользователь видит снимок уже размонтированного
ридера, пока стек продолжает считать закрытие незавершённым. Согласованный upstream snapshot patch устранил воспроизведение в проверенных
16 циклах. Внутренний механизм потери completion внутри UIKit не установлен.

Локальные диагностические артефакты:
`/tmp/narra-ios27-frozen-sample.txt`, `/tmp/narra-ios27-frozenStack.txt`,
`/tmp/narra-ios27-views.txt`, `/tmp/narra-ios27-controllers.txt`,
`/tmp/narra-ios27-modalState.txt`.

## Что установлено в исходном коде до исправления

- `ReaderTopBar.ios.tsx:106`: SwiftUI Button вызывает `hapticLight()` и сразу
  `onClosePress()`. Ожидания хаптика нет; helper перехватывает отказ native API.
- `ReaderScreen.tsx:182`: закрытие готовит тень обложки и сразу вызывает
  `navigation.goBack()`. Здесь нет ожидания сети, загрузки книги или сохранения.
  Сохранение прогресса запускается отдельно при размонтировании. Это не исключает
  нагрузку при размонтировании, но исключает явный await перед goBack.
- `sheet-zoom-return.ts`: таймер 1200 мс восстанавливает тень, а не откладывает
  навигацию. Map переиспользует ключ и удаляет callback при размонтировании.
- `RootNavigator.tsx:192`: ридер — `fullScreenModal`. Нативный
  `SystemSheetZoom.swift` назначает UIKit `preferredTransition = .zoom`.
- Установлен `react-native-screens@4.25.2`. Его
  `ios/RNSScreenStack.mm:1379` при размонтировании вызывает `setViewToSnapshot`,
  удаляет исходный экран из родителя. `ios/RNSScreen.mm:2044` заменяет
  `controller.view` снимком. До этого изменения pnpm patch не исправлял данный механизм.
- В `RNSScreenStack.mm:387` новые обновления модальных экранов откладываются,
  пока `_updatingModals` установлен. Сброс на этой цепочке выполняет completion
  `afterTransitions`. В iOS 27 Simulator подтверждено сохранение флага после
  размонтирования ридера; точный механизм потери completion ещё проверяется.

Застывший pressed state сам по себе не различает заблокированный основной поток,
оставшийся сверху снимок и незавершённый переход.

## Сопоставление с upstream

1. [react-native-screens #4407](https://github.com/software-mansion/react-native-screens/pull/4407),
   merged 28 июля 2026: подтверждён дефект замены `controller.view` снимком.
   UIKit повторно добавляет исходный экран, затем удаляет только снимок; оставшийся
   экран блокирует касания. Исправление сохраняет исходный view и добавляет снимок
   внутрь него, согласует unmount и invalidation. Этот согласованный набор изменений перенесён в существующий pnpm patch.
   Однако воспроизведение автора включает пересечение stack/tab переходов,
   а пользователь сообщает повторные открытия fullscreen reader. Совпадение
   дефектного кода весомо, но сценарии не идентичны.
2. [Expo #42797](https://github.com/expo/expo/issues/42797) и
   [документация zoom](https://docs.expo.dev/router/advanced/zoom-transition/#known-limitations)
   описывают паузу порядка секунды при повторных переходах. Это не доказательство
   причины полного зависания. Предложенный
   [PR #4711](https://github.com/software-mansion/react-native-screens/pull/4711)
   на момент проверки открыт; его guard требует `isMovingFromParentViewController`
   и рассчитан на stack pop. Переносить его в fullscreen modal как готовый фикс нельзя.
3. [screens #3648](https://github.com/software-mansion/react-native-screens/issues/3648)
   описывает зависание при dismiss fullscreen modal, но обсуждение связывает
   воспроизведение с прежним `expo-dev-client`; подтверждён фикс в Expo #43520.
   Это слабое объяснение текущего TestFlight, не основание менять presentation.

## Откуда мог появиться сценарий

| Изменение | Подтверждённый факт |
| --- | --- |
| `21042f46c`, 2 августа | В app package закреплена screens 4.25.2. |
| `b05bff915`, 23 августа | Добавлена общая нативная инфраструктура sheet zoom. |
| `410cbcfe`, 25 сентября | Именно Reader подключён к zoom обложки через zoomSourceId; gestureEnabled изменён для такого открытия. Это наиболее релевантное изменение, расширившее использование проблемного lifecycle. |
| `47759abd`, 25 сентября | В source provider добавлено временное отключение clipping предков обложки на возврате. |
| `b561ed0c`, 1 октября | Ограничено число карточек Popular; добавлен light на X. Сам closeReader и нативная zoom-цепочка этим коммитом не менялись. |

Это история появления условий, **не результат git bisect и не установленный
коммит-регрессия**. Последнее изменение окна карточек тоже нельзя окончательно
исключить без A/B; повтор на My books и с отключённым zoom позволит сузить причину.

## Первоначальная runtime-проверка и ограничение доступа

- Wrapper `build_and_run.sh check` подтвердил существующий dev-client build 36,
  актуальный native fingerprint, Xcode 26.6, iOS Simulator 26.5, Metro 8081.
  Пересборка не запускалась.
- В симуляторе открылась «Человек-амфибия»; последующий горизонтальный жест сменил
  заглавие раздела. JS отвечал через локальный диагностический probe. Полное
  зависание не воспроизведено: серию нажатий не удалось завершить из-за ошибок
  desktop ScreenCaptureKit -3811 и HID broker инструмента. Это ошибки инструментов,
  не свидетельство зависания Narra.
- Пользователь предложил исследовать уже зависший телефон. USB видит iPhone.
  CoreDevice сообщает iPhone 15 Pro Max / iOS 27.0 (24A5418b), но статус устройства
  `unavailable`; чтение процессов и снимок экрана возвращают CoreDevice 4016.
  Проверка чтения процессов инструментами Xcode 27 дала ту же ошибку.
  Зависшее приложение не перезапускалось, не переустанавливалось, сигналы ему
  не отправлялись. Запрошено переподключение кабеля с сохранением зависшего экрана.
- Повторная проверка после переподключения: macOS зарегистрировала новый USB attach
  около 15:32:42, интерфейс `en10` активен. Однако `remoted` получает
  `connect(2) failed [60: Operation timed out]`; процессы по-прежнему недоступны
  (4016), попытка восстановить существующее pairing-соединение завершилась 4000.
  На Mac активен Amiconnect-VPN. Это возможная причина недоступности диагностики,
  не доказанная причина зависания приложения. Apple описывает влияние VPN на
  служебное соединение с устройством в
  [TN3158](https://developer.apple.com/documentation/technotes/tn3158-resolving-xcode-15-device-connection-issues).
  VPN и настройки доверия не менялись.

## Переданные пользователем отчёты iPhone

Проверены семь файлов из Downloads за 1 октября. Упоминаний Narra/readany и
стеков процесса приложения в них нет:

- `DiagnosticRequest_com_apple_autobugcapture_Performance_2026_10_01.ips` —
  запрос AutoBugCapture от 12:41:27 MSK о превышении лимита памяти процессом
  `dasd`; содержит ссылки на memgraph и case summary на телефоне, а не сами файлы.
- Четыре `Analytics-…session.ips.ca.synced` — статистика загрузок MobileAsset.
- `AccessoryCrash-2026-10-01-104202.ips` — сбой аудиоаксессуара.
- `IntelligencePlatformComputeService_diskwrites_resource_2026_10_01.ips` —
  превышение порога записи на диск сервисом Apple за период до 10:49:41 MSK;
  `Action taken: none`. Связь с зависанием Narra не установлена.

Файлы подтверждают iOS 27.0 (24A5418b), но не объясняют зависание ридера.
Полного архива `sysdiagnose_…tar.gz` среди вложений нет.

## Исправление и проверка

В `patches/react-native-screens@4.25.2.patch` перенесён согласованный фикс #4407:
снимок добавляется внутрь исходного view, UIKit завершает его удаление после
перехода, а invalidated-компонент больше не отправляет progress/header callbacks.
Удалён ставший ненужным `_initialView`. Версия зависимости не повышалась,
предыдущие патчи сохранены; lockfile меняет только patch hash и зависимый peer hash.

- Патч применён через `pnpm patch-commit`, затем проверен `git apply --check`
  на чистом пакете 4.25.2. Полученные native-файлы совпали с установленными.
- `READANY_SIMULATOR_ID=89DF38B4-5C83-4D6F-B622-1D22F7AE0AA5 ./script/build_and_run.sh rebuild-ios`
  из `packages/app-expo` завершился `BUILD SUCCEEDED`, приложение установлено.
- На iPhone 17 Pro / iOS 27.0 успешно выполнено 16 циклов открыть → X → библиотека:
  10 из Popular и 6 из My books, включая повтор одной книги, разные книги и
  закрытие во время загрузки. Зависание не повторилось.
- Ponytail-review: лишних абстракций, зависимостей и таймеров не добавлено.
- Пока не проверены физический iPhone, Release/TestFlight runtime и iOS 26
  с новым патчем. Проверка не является доказательством отсутствия всех гонок.

Повторяемая проверка регрессии: открыть одну книгу из Popular и закрыть X
10 раз подряд, затем повторить в My books. Каждый раз библиотека должна
принимать касания; проверить повтор после прокрутки Popular и закрытие во время
загрузки. Исходный дефект воспроизводился примерно на втором цикле.

Лог нативной сборки: `/tmp/narra-reader-freeze-build.log`.
