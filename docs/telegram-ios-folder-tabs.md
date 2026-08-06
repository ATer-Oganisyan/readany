# Переключатель папок в Telegram для iOS

## Краткий вывод

В актуальной версии `Telegram-iOS` переключатель папок — не системный `UISegmentedControl`. Это связка из двух собственных компонентов:

1. `HorizontalTabsComponent` рисует горизонтальную панель вкладок, счётчики непрочитанных и перемещаемую капсулу выбранной папки.
2. `ChatListContainerNode` держит отдельные списки чатов для текущей и соседних папок, перемещает их по горизонтали и передаёт прогресс свайпа обратно панели вкладок.

За счёт общей величины `transitionFraction` список чатов и индикатор выбранной вкладки двигаются синхронно с пальцем.

Документ описывает состояние ветки `master` на коммите [`6ad963e`](https://github.com/TelegramMessenger/Telegram-iOS/commit/6ad963e5b62d354da79040f388ae2b9132fb17b8).

## Карта компонентов

```text
chatListFilterItems(context:)
        │
        │ папки, заголовки и непрочитанные
        ▼
ChatListController.reloadFilters()
        │
        ├── tabContainerData
        └── availableFilters
                │
                ▼
ChatListControllerNode
        │
        ├── HorizontalTabsComponent      — панель вкладок
        └── ChatListContainerNode        — страницы со списками чатов
                │
                │ transitionFraction
                ▼
HorizontalTabsComponent.View
        │
        ▼
LiquidLensView                          — капсула выбора
```

## Где находится реализация

| Задача | Файл |
|---|---|
| Модель вкладки, компоновка, нажатия, badge, перетаскивание | [`HorizontalTabsComponent.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/TelegramUI/Components/HorizontalTabsComponent/Sources/HorizontalTabsComponent.swift#L140) |
| Добавление панели в шапку списка чатов | [`ChatListControllerNode.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/ChatListUI/Sources/ChatListControllerNode.swift#L1515) |
| Загрузка папок, непрочитанных и Premium-лимита | [`ChatListController.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/ChatListUI/Sources/ChatListController.swift#L3990) |
| Нажатие на вкладку и программное переключение | [`ChatListController.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/ChatListUI/Sources/ChatListController.swift#L4119) |
| Горизонтальный свайп между папками | [`ChatListControllerNode.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/ChatListUI/Sources/ChatListControllerNode.swift#L597) |
| Размещение страниц со списками чатов | [`ChatListControllerNode.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/ChatListUI/Sources/ChatListControllerNode.swift#L1027) |
| Стеклянная капсула выбранной вкладки | [`LiquidLensView.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/TelegramUI/Components/LiquidLens/Sources/LiquidLensView.swift#L156) |
| Старая реализация вкладок и актуальные типы entry/id | [`ChatListFilterTabContainerNode.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/TelegramUI/Components/ChatList/ChatListFilterTabContainerNode/Sources/ChatListFilterTabContainerNode.swift#L438) |

## 1. Модель вкладки

`HorizontalTabsComponent.Tab` содержит:

- уникальный `id`;
- текстовый или произвольный контент;
- необязательный счётчик `Badge`;
- действие обычного нажатия;
- действие контекстного меню;
- действие удаления в режиме редактирования.

Для папок Telegram использует следующее соответствие:

| Папка | ID вкладки |
|---|---|
| «Все» | `Int32.min` внутри UI и `.all` в модели списка |
| Пользовательская папка | её `Int32` ID |

В `ChatListControllerNode` каждая запись `ChatListFilterTabEntry` преобразуется в `HorizontalTabsComponent.Tab`. Для пользовательской папки туда передаются название и число непрочитанных. Счётчик создаётся только при значении больше нуля.

Если среди непрочитанных есть сообщения без mute, badge получает акцентный фон. Иначе используется неактивный цвет непрочитанных из темы.

## 2. Внешний вид и компоновка

### Заголовок

Основные параметры элемента вкладки:

- шрифт: `Font.medium(15.0)`;
- горизонтальный внутренний отступ: 16 pt с каждой стороны;
- промежуток перед badge: 5 pt;
- badge использует `Font.medium(12.0)`;
- внутренние отступы badge: 5 pt слева и справа, 1 pt сверху и 2 pt снизу.

Цвет текста берётся из `theme.chat.inputPanel.panelControlColor`, поэтому компонент автоматически следует теме Telegram.

### Режимы ширины

У компонента есть два режима:

- `.fill` — панель занимает всю доступную ширину;
- `.fit` — ширина панели ограничивается фактической шириной вкладок.

Для папок применяется стандартный `.fill`.

Если все вкладки помещаются, доступная ширина делится между ними поровну. Сам текст остаётся центрированным внутри своей области нажатия. Если вкладки не помещаются, их ширина определяется содержимым, а панель становится горизонтально прокручиваемой.

Системные индикаторы прокрутки скрыты. При смене папки компонент старается оставить выбранную вкладку видимой и использует запас прокрутки 100 pt.

### Два слоя содержимого

Для каждой вкладки создаются две визуальные копии:

- `regularView` — обычное состояние;
- `selectedView` — содержимое внутри выделенной капсулы.

Обычные копии находятся в `scrollView`, а выбранные — в отдельном `selectedScrollView`. `LiquidLensView` маскирует второй слой так, чтобы он был виден только внутри перемещаемой капсулы.

Такой подход позволяет не менять состояние текста и badge вручную в каждом кадре: двигается маска, а выбранный слой уже находится под ней.

## 3. Капсула выбранной папки

За индикатор отвечает `LiquidLensView`.

Панель оставляет по 3 pt с каждой стороны, поэтому эффективная высота капсулы равна высоте компонента минус 6 pt. Радиус скругления равен половине этой высоты.

### iOS 26 и новее

Telegram динамически ищет приватный системный класс `_UILiquidLensView` через `NSClassFromString`. Ему передаются:

- контейнер поднятого содержимого;
- содержимое выбранной вкладки;
- punchout-слой обычного содержимого;
- режим деформации содержимого под линзой.

Это даёт нативное жидкое стекло с деформацией и анимацией линзы.

### Более ранние версии iOS

Если системная линза недоступна, Telegram использует собственный fallback:

- растягиваемое круглое изображение как маску;
- отдельную маску выбранного содержимого;
- стеклянную заливку капсулы;
- прозрачность `0.075` в светлой теме и `0.1` в тёмной.

Таким образом, структура панели остаётся одинаковой на всех версиях iOS, меняется только способ визуализации линзы.

## 4. Нажатие на вкладку

Панель использует собственный `UITapGestureRecognizer`. После завершения жеста она проверяет, в какую `selectionFrame` попала точка, и вызывает `tab.action()`.

Дальнейшая цепочка выглядит так:

```text
HorizontalTabsComponent.Tab.action
        ↓
ChatListController.selectTab(id:)
        ↓
получение актуального ChatListFilter
        ↓
ChatListContainerNode.switchToFilter(id:)
        ↓
смена текущего списка и spring-анимация
```

Если пользователь нажал уже выбранную папку, Telegram не переключает страницу, а прокручивает текущий список наверх.

При переключении на уже подготовленную соседнюю страницу используется spring-анимация длительностью 0.35 секунды. Если нужная страница ещё не создана, Telegram сначала ждёт готовности её списка, а затем выполняет переход.

## 5. Свайп между папками

Горизонтальный жест находится не внутри панели вкладок, а на контейнере всего списка чатов. Для него используется `InteractiveTransitionGestureRecognizer`.

Во время движения вычисляется:

```swift
transitionFraction = translation.x / layout.size.width
```

Знак определяет направление, а абсолютное значение — прогресс перехода.

Для каждой загруженной страницы положение рассчитывается как:

```swift
let indexDistance = CGFloat(index - selectedIndex) + transitionFraction
let x = indexDistance * layout.size.width
```

Таким образом:

- текущая страница начинается в `x = 0`;
- следующая находится справа на одну ширину экрана;
- предыдущая — слева;
- во время свайпа все участвующие страницы двигаются одним выражением.

### Условия завершения свайпа

Telegram выбирает соседнюю папку, если:

- горизонтальная скорость по модулю больше `10`, а её направление совпадает с движением;
- либо перемещение превысило половину ширины экрана.

Иначе страница возвращается в исходное положение. Финальная анимация использует spring-кривую и длительность 0.45 секунды.

На первом и последнем доступном фильтре применяется rubber banding. При попытке пройти за Premium-лимит жест отменяется и показывается экран ограничения.

## 6. Синхронизация списка и индикатора

В `ChatListController` назначается callback `currentItemFilterUpdated`. Он получает:

- выбранный фильтр;
- текущую `transitionFraction`;
- тип анимации;
- признак принудительного обновления.

Callback находит `HorizontalTabsComponent.View` внутри шапки и вызывает:

```swift
tabsView.updateTabSwitchFraction(
    fraction: fraction,
    isDragging: container.isSwitchingCurrentItemFilterByDragging,
    transition: ComponentTransition(transition)
)
```

Внутри панели знак fraction разворачивается, после чего рамка выбранной вкладки интерполируется между текущей и соседней:

```swift
selectedX = currentX * (1.0 - fraction) + pendingX * fraction
selectedWidth = currentWidth * (1.0 - fraction) + pendingWidth * fraction
```

Поэтому капсула одновременно:

- следует за пальцем;
- перемещается к соседней вкладке;
- плавно меняет ширину под новый заголовок;
- прокручивает саму панель, когда целевая вкладка выходит за видимую область.

## 7. Подготовка соседних списков

Контейнер не держит в памяти страницы для всех папок. В обычном состоянии он сохраняет только:

- выбранную страницу;
- предыдущую, если она существует;
- следующую, если она существует.

Для отсутствующих соседей создаётся `ChatListContainerItemNode`. Страницы вне этого диапазона удаляются из иерархии.

Это уменьшает количество одновременно работающих списков, но сохраняет мгновенный свайп к ближайшей папке.

Перед началом перехода Telegram также выравнивает вертикальное положение соседнего списка с состоянием навигационной шапки текущего списка. Благодаря этому шапка не прыгает при горизонтальном переключении.

## 8. Непрочитанные и обновление данных

`ChatListController.reloadFilters()` подписывается на `chatListFilterItems(context:)`. Поток возвращает:

- список папок;
- число непрочитанных для каждой папки;
- наличие непрочитанных без mute;
- порядок папок.

После обновления Telegram формирует две структуры:

- `tabContainerData` для панели вкладок;
- `availableFilters` для контейнера списков.

Если выбранная папка была удалена, контроллер пытается выбрать ближайшую предыдущую существующую папку. Если подходящей нет, используется «Все».

Для пользователя без Premium отдельно сохраняется `maxFoldersCount`. Этот лимит применяется и к нажатию, и к горизонтальному свайпу.

## 9. Контекстное меню, редактирование и сортировка

Каждая вкладка обёрнута в `ContextControllerSourceView`, поэтому долгое нажатие может открыть контекстное меню папки.

В режиме редактирования:

- обычные действия вкладки отключаются;
- у пользовательских папок появляется кнопка удаления;
- вкладки начинают слегка покачиваться;
- включается собственный `ReorderingGestureRecognizer`.

Сортировка начинается после удержания 0.2 секунды. Если до срабатывания таймера палец сместился больше чем на 4 pt, распознавание отменяется. Во время перемещения Telegram:

- увеличивает активную вкладку до `1.2`;
- снижает её прозрачность до `0.9`;
- автоматически прокручивает панель у краёв;
- переставляет соседние элементы;
- даёт тактильный отклик при изменении позиции.

Главная вкладка «Все» не получает действие удаления.

## 10. Старая реализация

В репозитории всё ещё присутствует `ChatListFilterTabContainerNode`. Это предыдущая самостоятельная реализация панели на `AsyncDisplayKit` с собственным `ASScrollNode`, фоном выбранной вкладки и логикой сортировки.

В актуальном экране списка чатов визуальный интерфейс строится через `HorizontalTabsComponent`, но из старого модуля всё ещё используются типы:

- `ChatListFilterTabEntryId`;
- `ChatListFilterTabEntry`;
- `ChatListFilterTabEntryUnreadCount`.

Поэтому при переносе механики ориентироваться следует на `HorizontalTabsComponent` и `ChatListContainerNode`, а не на старый `ChatListFilterTabContainerNode`.

## 11. Что важно воспроизвести в другом приложении

Минимальная архитектура такого поведения состоит из пяти частей:

1. Единая модель папок с ID, названием и счётчиком.
2. Горизонтальная панель с адаптивной шириной элементов.
3. Отдельный контейнер страниц, располагающий соседние списки на ширину экрана.
4. Общий интерактивный прогресс перехода для страниц и индикатора.
5. Предзагрузка только соседних страниц.

Ключевой принцип Telegram — выбранная капсула не управляет переходом. Источником истины остаётся контейнер списков, а панель только визуализирует его состояние. Это предотвращает рассинхронизацию между выбранной папкой и показанным списком.

## Исходники

- [TelegramMessenger/Telegram-iOS](https://github.com/TelegramMessenger/Telegram-iOS)
- [`HorizontalTabsComponent.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/TelegramUI/Components/HorizontalTabsComponent/Sources/HorizontalTabsComponent.swift)
- [`ChatListController.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/ChatListUI/Sources/ChatListController.swift)
- [`ChatListControllerNode.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/ChatListUI/Sources/ChatListControllerNode.swift)
- [`LiquidLensView.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/TelegramUI/Components/LiquidLens/Sources/LiquidLensView.swift)
- [`ChatListFilterTabContainerNode.swift`](https://github.com/TelegramMessenger/Telegram-iOS/blob/6ad963e5b62d354da79040f388ae2b9132fb17b8/submodules/TelegramUI/Components/ChatList/ChatListFilterTabContainerNode/Sources/ChatListFilterTabContainerNode.swift)
