# Handoff: iOS sheet → «Чат» morph

Дата: 21 августа 2026

## Статус

Задача пока не решена.

Последнее двухфазное решение убрало клиппинг шторки, но создало две неприемлемые продуктовые регрессии:

1. Открытый диалог больше нельзя закрыть одним непрерывным жестом.
2. После закрытия кнопка «Чат» появляется отдельным кадром.

Актуальная запись:

- `/Users/manaer/Desktop/Screen Recording iPhone 17 Pro 21.08.2026 at 00.17.49.mp4`

## Требуемое поведение

Нужен нативный интерактивный morph iOS-шторки в кнопку «Чат»:

- из списка персонажей;
- из открытого диалога;
- после возврата из диалога к списку;
- одним непрерывным жестом;
- без обрезания шторки;
- без двойной кнопки и ghost-слепка;
- без однокадрового появления кнопки после transition;
- overlay за шторкой должен исчезать синхронно с закрытием.

## Изначальный дефект

Предыдущая запись:

- `/Users/manaer/Desktop/Screen Recording iPhone 17 Pro 20.08.2026 at 23.30.24.mp4`

Покадровый разбор показал:

- список нормально закрывался из `medium` detent;
- открытый диалог находился в `large` detent;
- при его закрытии UIKit сначала запускал обычный вертикальный dismiss `formSheet`;
- затем Zoom-transition подхватывал уже смещённую и частично ушедшую за экран геометрию;
- из-за стыка этих двух фаз появлялись клип снизу, узкая полоса диалога, огромная или двойная кнопка и летящий snapshot;
- скорость свайпа меняла момент переключения между фазами, поэтому внешне баг выглядел плавающим.

Нормальный morph списка объясняется тем, что его геометрия не менялась после открытия: он всё время оставался в стабильном `medium` detent.

Связанное предыдущее расследование:

- `docs/ios-sheet-flying-bug-investigation-2026-08-20.md`

## Выводы по публичному UIKit API

### `UISheetPresentationController.animateChanges`

У метода нет completion. Возврат из `animateChanges` не означает, что визуальная resize-анимация закончилась.

Официальный способ получить окончание реального изменения размера presented controller:

- `viewWillTransition(to:with:)`;
- переданный `UIViewControllerTransitionCoordinator`;
- completion через `coordinator.animate(alongsideTransition:completion:)`.

### `ZoomOptions.interactiveDismissShouldBegin`

Callback может только разрешить или запретить уже рассматриваемый Zoom-dismiss.

Он не предоставляет:

- доступ к системному gesture recognizer;
- управление приоритетом между Zoom и sheet pan;
- `require(toFail:)`;
- гарантию, что Zoom заберёт жест у `UISheetPresentationController`.

Возврат `true` не заставляет Zoom победить gesture arbitration.

### `alignmentRectProvider`

Он управляет прямоугольником выравнивания source внутри destination view.

Он не управляет:

- crop или mask;
- clipping контейнера шторки;
- sheet chrome и corner radius;
- dimming overlay;
- gesture arbitration.

Для текущего morph его следует оставлять `nil`.

### Lifecycle `preferredTransition`

`preferredTransition` оказался чувствителен к смене detent. Если оставить один Zoom-transition на весь срок жизни `RNSScreen`, последующий dismiss может использовать геометрию, созданную до resize.

Рабочая гипотеза: Zoom нужно снимать перед сменой detent и создавать заново после фактического завершения size-transition.

## Внесённые изменения

### Native

Файл:

- `packages/app-expo/modules/morph-sheet-transition/ios/MorphSheetTransitionModule.swift`

Изменения:

- source repository возвращает source view только пока она действительно находится в `window`;
- добавлен дочерний `SheetResizeObserverViewController`;
- observer получает `viewWillTransition(to:with:)` от `RNSScreen`;
- перед программной сменой detent текущий Zoom снимается;
- после completion нативного size-transition устанавливается свежий `preferredTransition = .zoom`;
- добавлены generation tokens для защиты от устаревших completion;
- `expandSheet` и `collapseSheet` теперь получают Expo `Promise`;
- Promise завершается после фактического resize и повторной установки Zoom, а не сразу после запуска `animateChanges`;
- pending Promise отклоняется при supersede или unmount;
- `ZoomOptions` оставлен без `interactiveDismissShouldBegin` и `alignmentRectProvider`;
- добавлен cleanup child observer и transition state.

### React Native flow

Файл:

- `packages/app-expo/src/screens/NarraCharactersScreen.tsx`

Изменения:

- добавлен `usePreventRemove`;
- переходы между списком и диалогом выполняются внутри одной form-sheet route;
- при открытии диалога шторка программно расширяется;
- при возврате шторка программно уменьшается до `medium`;
- добавлены fade-переходы между контентом;
- при попытке закрыть открытый диалог removal route отменяется;
- контент возвращается к списку;
- шторка уменьшается до `medium`;
- после completion resize исходный navigation action отправляется повторно;
- финальный Zoom выполняется из стабильного списка в кнопку «Чат».

## Почему текущее решение не подходит

Отсутствие закрытия одним жестом является прямым следствием `usePreventRemove`-архитектуры:

1. Пользователь начинает интерактивный dismiss диалога.
2. React Navigation отменяет удаление route.
3. Первый жест визуально прекращается или отскакивает.
4. Приложение программно показывает список и уменьшает sheet.
5. Сохранённый navigation action отправляется повторно.
6. Запускается отдельный, уже не связанный с пальцем Zoom-dismiss.

Публичный API не позволяет сохранить velocity и продолжить тот же системный жест после отмены. Поэтому этот подход принципиально не может выполнить требование «один непрерывный жест».

Вторая проблема — однокадровое появление кнопки — пока не локализована окончательно. Нужно покадрово определить, появляется ли:

- реальная source-кнопка из reader toolbar;
- snapshot source, созданный UIKit;
- дубликат из двух одновременно живых переходов.

Вероятная зона проверки — рассинхронизация lifecycle source view и завершения программно повторённого navigation action.

## Последние незавершённые правки

После внутреннего code review дополнительно были внесены изменения:

- обработка быстрого dismiss во время начального fade-out списка;
- direct dismiss разрешается только для действительно стабильного списка;
- учтён `Bool`, возвращаемый `coordinator.animate(...)`;
- если completion не удалось зарегистрировать, используется синхронный no-resize fallback;
- добавлено завершение pending JS Promise при teardown.

Эти последние правки находятся в файлах, но после них не запускались:

- нативный rebuild;
- TypeScript check;
- Biome;
- повторная ручная проверка.

Их нельзя считать проверенными.

## Что было проверено до последних правок

Проходили следующие команды:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm exec biome check src/screens/NarraCharactersScreen.tsx
git diff --check
./script/build_and_run.sh rebuild-ios
```

Нативная сборка завершилась с `BUILD SUCCEEDED`.

На iPhone 17 Pro Simulator с iOS 27 проверялись:

- прямое закрытие списка;
- закрытие диалога через двухфазную нормализацию;
- диалог → кнопка «Назад» → список → закрытие.

Клиппинг и летящий snapshot в этих прогонах исчезли, но новая запись показала, что продуктовые критерии не выполнены.

Не проверялось:

- физическое устройство;
- iOS 26;
- последние race-condition правки;
- серия из быстрых и медленных повторов после последних изменений.

## Артефакты предыдущей проверки

Временные записи и раскадровки:

- `/private/tmp/narra-dialog-dismiss-fixed.mp4`
- `/private/tmp/narra-direct-list-dismiss.mp4`
- `/private/tmp/narra-back-then-dismiss.mp4`
- `/private/tmp/narra-dialog-dismiss-fixed-contact.jpg`
- `/private/tmp/narra-direct-list-dismiss-contact.jpg`
- `/private/tmp/narra-back-then-dismiss-close.jpg`
- `/private/tmp/narra-sheet-regression-233024/keyframes-four-dismissals.png`
- `/private/tmp/narra-sheet-regression-233024/contact-4fps-labeled.png`

Файлы в `/private/tmp` могут исчезнуть после перезагрузки.

## Файлы для ревью

Основные изменённые файлы:

- `packages/app-expo/modules/morph-sheet-transition/ios/MorphSheetTransitionModule.swift`
- `packages/app-expo/src/screens/NarraCharactersScreen.tsx`

Source и destination bridge:

- `packages/app-expo/src/components/navigation/MorphSheetTransition.ios.tsx`
- `packages/app-expo/src/components/navigation/MorphSheetTransition.types.ts`

Source-кнопка «Чат»:

- `packages/app-expo/src/screens/reader/ReaderToolbar.ios.tsx`

Настройки form sheet:

- `packages/app-expo/src/navigation/RootNavigator.tsx`

## Рекомендуемый порядок ревью

1. Покадрово разобрать актуальную запись `00.17.49.mp4` и классифицировать однокадровую кнопку как real source или UIKit snapshot.
2. Не считать двухфазный `usePreventRemove` финальным решением: он по конструкции нарушает требование одного жеста.
3. Изолированно проверить native rearm после detent без JS-перехвата dismiss.
4. Проверить, на правильном ли controller устанавливается `preferredTransition`: `RNSScreen`, его navigation controller или фактический presented controller.
5. Определить, почему large-detent сначала запускает обычный sheet dismiss, хотя свежий Zoom уже установлен.
6. Проверить lifecycle и visibility source view во время интерактивного и программного dismiss.
7. Не добавлять таймеры, ручные mask-анимации и собственные gesture recognizers, пока не доказано, что публичный UIKit API недостаточен.

## Критерии готовности

1. Список закрывается одним непрерывным интерактивным morph в кнопку.
2. Открытый диалог закрывается тем же одним жестом, без промежуточного списка.
3. Сценарий диалог → назад → список → закрытие также morphится.
4. Шторка не клиппается снизу.
5. Нет узкой полосы, ghost-слепка, огромной или двойной кнопки.
6. Кнопка «Чат» не появляется отдельным кадром после transition.
7. Overlay за шторкой исчезает синхронно с интерактивным закрытием.
8. Каждый сценарий проходит минимум 10 раз медленным и быстрым свайпом.

## Состояние worktree

Коммита с этими изменениями нет.

В worktree находятся другие пользовательские изменения и новые файлы, не относящиеся напрямую к sheet morph. Нельзя использовать `git reset`, `git checkout --` или массово откатывать dirty tree. При ревью нужно ограничить diff указанными выше файлами и сохранять все посторонние изменения.
