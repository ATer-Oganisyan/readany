# Исследование мигания book sheet при закрытии

Дата: 14 сентября 2026. Проверка на iPhone 17 Pro Simulator, iOS 27.0, dev-client Narra. Базовый native-код соответствует `698a1e4db`; существующие незакоммиченные изменения оформления сохранены.

## Результат

**Дефект воспроизведён с обычными UIKit-участниками перехода внутри текущего приложения.** Для появления симптома не обязательны наши компоненты обложки, Expo zoom views, SwiftUI glass или presentation через React Native Screens.

Это сужает поиск до системного перехода, конфигурации sheet и окружения приложения. Это **ещё не доказывает** ошибку iOS в отдельном приложении без React Native. Точный внутренний триггер и исправление пока не установлены.

В продуктовом коде используется нативный `UIViewController.preferredTransition = .zoom(...)`. Это переход к view всего контроллера. Область обложки внутри него служит ориентиром выравнивания; API не предоставляет отдельный жизненный цикл перемещаемой shared-element обложки. Поэтому скачок масштаба контейнера увеличивает вместе с ним и содержимое.

## Что требует Apple

- Назначить `preferredTransition` до presentation. Получать актуальную исходную view по стабильному идентификатору; не сохранять переиспользуемую ячейку в closure. См. [Enhancing your app with fluid transitions](https://developer.apple.com/documentation/uikit/enhancing-your-app-with-fluid-transitions).
- `alignmentRectProvider` возвращает прямоугольник в координатах `zoomedViewController.view`. Для вложенной обложки подходит `cover.convert(cover.bounds, to: controller.view)`. `nil` в Swift означает отсутствие предпочтения. См. [API alignmentRectProvider](https://developer.apple.com/documentation/uikit/uiviewcontroller/transition/zoomoptions/alignmentrectprovider) и комментарий SDK в `UIKit.framework/Headers/UIZoomTransitionOptions.h:26`.
- Zoom поддерживает sheet. Интерактивный переход допускает смену направления и повторные callbacks; временное состояние должно быть минимальным и очищаться к `viewDidAppear` / `viewDidDisappear`. См. [WWDC24, 3:02–8:10](https://developer.apple.com/videos/play/wwdc2024/10145/?time=182).
- Detents располагаются по возрастанию. Custom resolver вычисляет высоту внутри safe area и не должен менять свойства sheet. См. [UISheetPresentationController](https://developer.apple.com/documentation/uikit/uisheetpresentationcontroller).

В основном подключении Narra нарушения этих правил не найдено: источник запрашивается заново, координаты переводятся в корневую view, переход назначается перед `presentViewController` и сохраняется при временном отсоединении view.

`[0.85, 1]` в текущем React Native Screens превращается в **два custom detent**, включая значение `1`; это не пара custom + системный `.large()`.

## Контрольное воспроизведение полного закрытия

Создано через LLDB в работающем Simulator, без нативной пересборки и изменения продуктового кода:

- Source: обычный `UIView` в view корневого контроллера, размер 177 × 259; поиск через стабильный tag.
- Destination: обычный `UIViewController`, `.formSheet`, custom detents `0.85 × maximumDetentValue` и `1 × maximumDetentValue`, начальный detent `0`, grabber включён.
- Содержимое: обычный `UIScrollView`, цветной `UIView` 180 × 264 в позиции (111, 35), `UILabel` под ним. Никаких React/Expo/SwiftUI-компонентов внутри destination.
- Переход: нативный zoom, alignment по bounds вложенной обложки, переведённым в координаты корневой view destination.
- Полный drag вниз: duration 0.75 s, 70 шагов; после завершения sheet действительно dismissed.

Результат по исходным кадрам:

| Кадры | Время записи | Что видно |
| --- | --- | --- |
| 1017 | 31.515 s | Уменьшенный синий sheet, голубая обложка и UILabel. |
| **1018–1021** | **31.532–31.583 s** | Синий контейнер и UILabel исчезают; остаются смещённый голубой прямоугольник и полупрозрачный след. |
| **1022** | **31.607 s** | Контейнер с UILabel внезапно возвращается. |
| 1023–1024 | 31.618–31.630 s | Продолжается движение к источнику. |

До возвращения проходит около 75 ms. Последовательность совпадает по характеру с продуктовым дефектом: это не только смена цвета текста.

Материалы текущей локальной диагностики:

- Видео: `/tmp/narra-apple-pure-uikit-fullclose.mp4`.
- 1111 исходных кадров и timestamps: `/tmp/narra-apple-pure-uikit-fullclose/` (`fNNNN.png`, `pts.json`, `closing.jpg`).
- [Три контрольных кадра](/Users/manaer/.codex/visualizations/2026/09/14/01a0977e-e953-77f2-ab46-b211ae86e07e/native-zoom-flicker-proof.jpg).

Извлечение кадров без ресемплинга: `ffmpeg -i input.mp4 -vf 'scale=402:874,setpts=N/TB' -fps_mode passthrough output/f%04d.png`. Метки времени берутся отдельно из исходного видео через ffprobe. `setpts` нужен только для записи PNG; временные подписи не берутся из изменённых PTS.

Ограничение: корневой host и каталог под контрольным sheet остаются Narra/React Native. Отдельный чистый UIKit executable и физическое устройство с этим контрольным примером не проверялись. Во время самого жеста LLDB-команды не выполнялись.

## Какие версии не подтвердились

На предыдущих полных закрытиях не срабатывали ветки потери source, отсутствия alignment target и подмены view снимком в RNSScreen. Проверка без alignment также не устранила продуктовый симптом.

В этом исследовании дополнительно поставлены счётчики:

- Первый полный dismiss из установившегося состояния: `RCTViewComponentView.invalidateLayer` — 0, фактический вызов `SystemSheetZoomDestinationView.updateDetent` → `sheet.animateChanges` — 0.
- При втором закрытии вызов `updateFormSheetPresentationStyle` пришёл от фонового RNSScreenView. До ветки установки detents закрываемого sheet (`RNSScreen.mm:966`) выполнение не дошло — 0.

Поэтому нельзя выдавать сброс opacity Fabric, повторную анимацию высоты или пересоздание detents за причину текущего мигания. Счётчики проверялись отдельно от контрольного видео; это не покадровая трасса каждого изменения слоя.

Apple DTS подтверждал другой дефект исчезающей исходной view при интерактивном zoom на iOS 26: [Forums 802908](https://developer.apple.com/forums/thread/802908). Это не подтверждение причины нашего случая и не готовое исправление.

## Следующий ограниченный эксперимент

Сохранить продуктовый native zoom и высоту 85%. На контрольном UIKit-примере сравнить `.formSheet` и `.pageSheet` при тех же двух custom detents и том же жесте. Затем, если необходимо, отдельно сравнить custom `1` с системным `.large()` и сделать контроль на другом runtime iOS. Менять один параметр за раз и проверять полное закрытие покадрово.

Переносить настройку в продукт только после исчезновения наблюдаемой последовательности «контейнер исчез → контейнер вернулся» и проверки открытия, короткого отменённого drag, полного закрытия и повторного открытия. Наличие native zoom само по себе не гарантирует отсутствия регрессий среды выполнения.

## Состояние после исследования

Контрольные views удалены, debugger отключён, Simulator возвращён в каталог. Временный режим записи в wrapper удалён; wrapper и native transition код по-прежнему совпадают с исходным состоянием. Продуктовый баг не исправлен. `git diff --check` проходит; новые unit tests не добавлялись, поскольку проверялось визуальное поведение UIKit.

## Последующие изменения по запросу пользователя

После исследования пользователь заменил требование начальной высоты 85% на системную `.medium`. BookDetails переведён на iOS `pageSheet`; существующее уведомление перед presentation расширено на этот тип. Native handler настроил реальные `.medium()` / `.large()`. В Simulator подтверждены идентификаторы `com.apple.UIKit.medium`, `com.apple.UIKit.large` и сохранённый `_UIZoomViewControllerTransition`.

Открытие, разворачивание, короткий отменённый drag и полное закрытие проверены. **Мигание осталось** и с системными detents: на записи `/tmp/narra-system-medium-verification.mp4` в 149.478–149.540 s контейнер исчезает, в 149.558 s возвращается. Кадры: `/tmp/narra-system-medium-controlled-close/flicker-close-detail.jpg`.

Затем пользователь попросил увеличить начальную высоту на 10%. Системная `.medium` заменена custom detent `bookPreview`; расчёт увеличивает половину высоты контейнера с учётом нижней safe area. Системный `.large()` и нативный zoom сохранены. Вариант `0.55 × maximumDetentValue` отвергнут при визуальной проверке: максимум detent уже исключает часть системных отступов и давал высоту ниже исходной `.medium`.

Финальная версия собрана для Simulator и физического iPhone Misha (iPhone 15 Pro Max), установлена и запущена. Metro работает через LAN. 31 существующий тест проходит, обе нативные сборки успешны, `git diff --check` проходит. Финальная начальная высота визуально проверена в Simulator; новая запись закрытия для последней прибавки 10% не снималась, отсутствие мигания не заявляется. Android-конфигурация в этом изменении не менялась.

## Повторная проверка видео и рекомендаций Apple

Повторно приложенный `IMG_3312.MP4` — та же запись от 14 сентября 10:33–10:34: 1290 × 2796, 9.177 s, 482 декодированных кадра. В обоих полных закрытиях пропадает вся композиция шторки (фон, заголовок, кнопка, описание), а отдельный фрагмент обложки остаётся:

| Эпизод | Шторка отсутствует | Возвращается | Интервал |
| --- | --- | --- | --- |
| Первый | Кадры 100–104, 1.875–1.942 s | Кадр 105, 1.958 s | ≈83 ms |
| Второй | Кадры 293–297, 5.702–5.768 s | Кадр 298, 5.785 s | ≈83 ms |

[Три исходных кадра](/Users/manaer/.codex/visualizations/2026/09/14/01a0977e-e953-77f2-ab46-b211ae86e07e/user-zoom-flicker-three-frames.jpg). По кадрам нельзя доказать внутренний механизм UIKit, но объяснение «не успевает загрузиться картинка» не соответствует наблюдаемому.

Дополнительно проверено одно программное `dismiss(animated: true)` текущего BookDetails («Отцы и дети», preview на 10% выше medium). Запись: `/tmp/narra-noninteractive-close-0914.mp4`, кадры и исходные PTS: `/tmp/narra-noninteractive-close-0914/`. Начальный неподвижный кадр находится в 0 s, следующий в 57.338 s после остановки LLDB; оба соответствуют начальному preview с верхом около338 из800. Далее записана вся анимация. В 57.362–57.445 s шторка постепенно растворяется, в 57.457–57.657 s обложка возвращается к source. **Повторного появления целой шторки нет.** Это один прогон на Simulator; он усиливает связь дефекта с интерактивным закрытием, но не доказывает причину или исправление на устройстве.

Повторная сверка [WWDC24](https://developer.apple.com/videos/play/wwdc2024/10145/?time=182) и [WWDC25 UIKit, 14:07](https://developer.apple.com/videos/play/wwdc2025/284/?time=847) подтверждает текущую основу: системный sheet, `preferredTransition = .zoom` на представленном контроллере, source по стабильному ID, alignment в координатах destination. Apple не требует fullscreen или самостоятельной анимации обложки. Публичный контракт не описывает управление внутренними snapshots/crossfade; добавление overlay или таймеров не является документированным исправлением.

`interactiveDismissShouldBegin` разрешает начало конкретного interactive zoom. `context.willBegin` означает, начался бы жест по умолчанию. Возврат `false` **не документирован** как замена zoom-dismiss обычным sheet-slide. Для запрета pull-down Apple описывает `isModalInPresentation` / `presentationControllerShouldDismiss`: [Zoom option](https://developer.apple.com/documentation/uikit/uiviewcontroller/transition/zoomoptions/interactivedismissshouldbegin), [sheet dismissal](https://developer.apple.com/documentation/uikit/disabling-the-pull-down-gesture-for-a-sheet).

Рекомендация: сохранить native zoom и выбранную высоту; изолировать интерактивный путь в отдельном минимальном UIKit-приложении и сравнить поведение runtime до следующего продуктового изменения. Проверка без React Native внутри Narra уже есть, но общий host ещё не исключён. Временный вариант с кнопкой закрытия и запретом pull-down требует отдельной проверки и меняет механику; в продукт он не внесён. Готового подтверждённого исправления, сохраняющего все жесты, пока нет.

## Сравнение с рабочим референсом Pickle

По запросу пользователя прочитан `/Users/manaer/Documents/ChatGPT/pickle/docs/card-opening-and-detail.md` и проверены упомянутые TSX-файлы и установленный `expo-router/ios/LinkPreview/LinkZoomTransition.swift`. Репозиторий Pickle не изменялся.

Главное различие: `item/[id]` в Pickle открывается обычным push в native stack, без `presentation: formSheet/pageSheet`, detents и изменения высоты. Это не полноэкранная модальная шторка. Narra использует pageSheet с custom preview и системным large. Оба используют один Apple API `UIViewController.preferredTransition = .zoom`; самописного zoom у Pickle нет.

Переносимые детали Expo:

- Source и alignment target — один непосредственный native-child; регистрация привязана к mount/unmount ребёнка. Narra регистрирует Expo-обёртки, source через didMoveToWindow. Это конкретное отличие, но потеря source при измеренном дефекте ранее не подтверждалась.
- Expo корректирует aspect ratio alignment rect под source, если включён animateAspectRatioChange. Для Narra source28/41 против target180/264 разница около0.43pt по высоте; это не объяснение исчезновения всей шторки на83ms.
- Expo отдельно настраивает переход и не управляет detents из alignment target. У Narra target также имеет expanded/updateDetent, но эта ветка не срабатывала во время ранее измеренного полного закрытия.

Прямое копирование Link.AppleZoom требует Expo Router Stack; Narra использует React Navigation, поэтому перевод всей навигации ради этого неоправдан. [Документация Expo](https://docs.expo.dev/router/advanced/zoom-transition/) также перечисляет известные ограничения native zoom и не обещает отсутствие визуальных дефектов при смене обёртки.

С учётом нового референса ближайший ограниченный A/B: временно открыть тот же BookDetails обычным push с native zoom и теми же source/cover/data; сравнить полное закрытие жестом и его отмену с pageSheet. Проверять именно push, а не pageSheet с detent1. Это лучше отделяет тип presentation от данных и изображения. Постоянный переход на полный экран меняет согласованную механику и на момент этой рекомендации не был внесён. Сохранение неполной шторки вместе со всеми жестами остаётся отдельной нерешённой частью.

## Тест push и передачи скейла, 14 сентября, 12:50

После согласования BookDetails переведён на тестовый native-stack push на iOS. Android сохраняет formSheet. Для BookDetails скрыт верхний scroll edge effect, автоматические inset заменены явным отступом с useHeaderHeight по референсу. Источник zoom зарегистрирован до удаления из superview, включая время вне UIWindow при push.

Пользователь попросил сохранить уменьшение при нажатии. Эксперимент с opacity отменён. В каталоге и «Моих книгах» на iOS возврат скейла 0.97 → 1 теперь завершается перед существующим открытием/подготовкой native zoom. Запуск идёт из callback завершения, без таймера. Возврат занимает до 150 мс; при уже завершённом скейле ожидания нет. Gesture finalize не перезапускает возврат во время передачи. Событие Pressable сохраняется до отложенной проверки swipe guard. Android и остальные применения PerspectiveBook не ждут возврата.

42 проверки проходят: book-details-render, catalog-search-render, catalog-chat-render, open-book-details. В тесте каталога актуализировано ожидание существующего второго аргумента sourceId.

Запись `/tmp/narra-scale-handoff-final.mp4`, 372 кадра с исходными timestamps в `/tmp/narra-scale-handoff-final-frames`. Открытие из каталога, закрытие жестом и открытие из «Моих книг» выполнены. При последующем Back из «Моих книг» переход не завершился: snapshot потерял targets, изображение осталось на BookDetails. Пользователь также сообщил о зависании. Это не доказательство исправления прежнего дефекта закрытия. Приложение остановлено и повторно запущено через MCP. Штатный wrapper отказался запускать из-за изменённого native fingerprint; пересборка не выполнялась, запущен уже установленный dev-client. Полное устранение рывков и мигания и проверка на физическом iPhone остаются неподтверждёнными.
