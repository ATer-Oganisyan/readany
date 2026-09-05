# Android: native crash и повторное падение аудиосервиса

Статус: независимая read-only диагностика; исправление и воспроизведение не приняты. Устройство принадлежало continuous_product_qa, навигация/перезапуск/сборка этим исследованием не выполнялись. Прочитаны правила Expo и expo-module; native-зависимости не редактировались.

## Доказанные события

Исходный артефакт: `evidence/continuous-product-qa-2026-09-05/00-crash-log.txt`. Даты — время Android logcat.

1. 14:51:29 — teardown корневого Gesture Handler в PID 16505.
2. 14:51:49 — повторный `Running main`, Fabric=true, в том же PID, JS thread 19148.
3. 14:51:52 — SIGSEGV / SEGV_ACCERR, процесс жил 4359 секунд. PC находится в `[anon:scudo:primary]`, вызывающий кадр — `MountingCoordinator::pullTransaction(bool) const+524`.
4. 14:51:53 — ActivityManager фиксирует смерть процесса и планирует restart MusicService.
5. 14:52:09 — новый PID 19186 падает в `MusicService.onStartCommand(null)` → `startAndStopEmptyNotificationToAvoidANR()` → `startForeground()`: `ForegroundServiceStartNotAllowedException`, UID находится в состоянии SVC, разрешение foreground denied.

Таким образом, TrackPlayer — доказанная **вторичная ошибка восстановления**, а не объяснение первого SIGSEGV. QA увидел уже открытый системный crash dialog: первичный жест пользователя неизвестен.

## Primary: локализация до native virtual call

Установленные локальные зависимости: Expo 57.0.14, RN 0.86.2, Reanimated 4.5.1, TrackPlayer 4.1.2, Screens 4.25.2. Нельзя считать этот список полной проверкой APK fingerprint, но проверена идентичность конкретной падающей native-библиотеки.

`llvm-readelf -n` для `android/app/build/intermediates/merged_native_libs/debug/mergeDebugNativeLibs/out/lib/arm64-v8a/libreactnative.so` показывает Build ID `5163d057cddef221149f17d63d6472ca859a5ebf` — точно как tombstone. Дизассемблирование адреса `0x11a564c` показывает `blr x8` после `weak_ptr<MountingOverrideDelegate>::lock()`, shared_ptr validity check и чтения vtable. По соответствующему исходнику это вызов `shouldOverridePullTransaction()`.

Это существенно сужает поиск: повреждённый/устаревший target виртуального вызова native mounting delegate. Это **не доказательство**, что виноват именно Reanimated: RN NativeAnimated и Reanimated оба регистрируют такие delegates. Предшествующий teardown и повторный main делают reload/lifetime-гипотезу сильнее, но не доказывают её и не исключают ранее повреждённую память. Нельзя лечить это отключением обработчика JS-ошибок или TrackPlayer catch.

Следующий эксперимент: повторяемый цикл reload dev-client при Library/Reader и активных/неактивных анимациях; отдельно тот же клиентский маршрут в standalone release без Metro. При воспроизведении собрать символизированный tombstone, delegate identity и lifetime-трассу; затем точечный dependency patch/upstream fix с воспроизведением до/после. Не обновлять весь Expo стек наугад.

## Secondary: конкретный дефект lifecycle

`patches/react-native-track-player@4.1.2.patch` уже переводит HeadlessJS на ReactHost, но `onStartCommand` по-прежнему безусловно запускает JS, временный foreground notification и возвращает `START_STICKY`. После смерти процесса аудиоочередь в памяти утрачена; даже null-intent restart вновь пытается повысить сервис в foreground. В данном исполнении Android это запретил.

В `src/App.tsx` TrackPlayer создаётся при каждом bootstrap, даже до просьбы пользователя озвучить книгу, и настроен ContinuePlayback. Это расширяет поверхность idle-service recovery. Существующий ReactHost listener также не хранится для отмены в onDestroy: поздний callback может стартовать задачу уже уничтоженного сервиса. Это найденный по коду риск, не причина доказанного SIGSEGV.

Рекомендуемая правка отдельным native patch:

- Обработать null-intent restart без восстановленной playback-сессии: не запускать пустой ReactHost/foreground service, остановить этот startId и вернуть START_NOT_STICKY. Не ломать легитимное продолжение уже работающей озвучки.
- Обрабатывать именно запрет foreground promotion с предсказуемой остановкой и cleanup, не общим catch, который скрывает другие исключения.
- Регистрируемый ReactHost listener хранить и удалять при уничтожении сервиса; проверить destroyed-флаг внутри отложенной задачи.
- Отдельно оценить lazy initialization по запросу воспроизведения. Это продуктовая доработка, не замена исправлению native crash.

Android документирует ограничения фонового foreground-start и необходимость обработки запрета; sticky foreground restart имеет отдельные исключения, поэтому не следует обобщать, что все sticky-restarts запрещены. [Foreground launch](https://developer.android.com/develop/background-work/services/fgs/launch), [Service API](https://developer.android.com/reference/android/app/Service).

## Обязательные регрессии

1. Native service test: null intent + нет playback → нет старта headless/notification, сервис завершается без crash и без restart-loop.
2. Native service test: foreground denial → bounded cleanup; другой exception не маскируется.
3. Pending ReactHost init → service destroy → поздний callback не запускает задачу.
4. Реальное Android-устройство/эмулятор API 31+ и текущий API: обычный cold start, TTS start/pause/resume, экран заблокирован, background, удаление task, process death с idle/active audio, повторное открытие без crash dialog, сохранённая точка чтения.
5. Отдельный native reload/repeated navigation soak для primary SIGSEGV, затем standalone release soak. JS unit tests и зелёный CI не доказывают устранение C++ lifetime-ошибки.

Пока обе ошибки открыты. Изменён только этот отчёт; логи не очищались, runtime и пользовательские книги не изменялись.

## Следующий этап: подготовленный secondary recovery patch

По отдельному поручению подготовлен кандидат в `patches/react-native-track-player@4.1.2.patch`. Он **не установлен**, pnpm install / lockfile refresh / native build не запускались; первичный SIGSEGV не исправлялся.

- Null intent с отсутствующей или пустой очередью: `stopSelf(startId)` + START_NOT_STICKY до обращения к ReactHost и foreground notification.
- Null intent с существующей непустой очередью (включая paused): оставить START_STICKY, не трогать notification/JS, не прерывать воспроизведение.
- Обычный explicit intent сохраняет foreground setup и запуск headless task; promotion выполняется до headless, чтобы не создавать незавершённую JS-задачу при ошибке notification.
- Уничтожение сервиса отменяет ожидающий ReactHost listener и предотвращает запуск уже поставленного UI callback. Заменённый callback не может запустить устаревшую задачу; task listener снимается с фактически использованного ReactContext, даже если host уже переключился.
- Новый catch не добавлен. Доказанная null-intent deniedpromotion ветка предотвращается. Запрет при отдельном explicit foreground-start, не связанном с этим restart, пока не обработан этим кандидатом; остальные исключения продолжают распространяться.

### Исполняемые Kotlin регрессии

`packages/app-expo/scripts/qa/native-trackplayer-recovery.mjs` берёт неизменённые тела четырёх настоящих Kotlin методов MusicService, компилирует их Kotlin compiler 2.0.21/JDK17 и исполняет с детерминированными Android/ReactHost портами из соседнего `.kt`. Candidate patch применяется только к временному файлу. Это **поведенческий Kotlin unit слой, не Robolectric и не acceptance Android framework**, не проверка наличия строк в исходнике. Полные imports/API linking, Binder, ExoPlayer, notification permissions и планировщик Android таким тестом не покрываются.

Команды из корня:

```sh
node packages/app-expo/scripts/qa/native-trackplayer-recovery.mjs
node packages/app-expo/scripts/qa/native-trackplayer-recovery.mjs --candidate
```

На установленной прежней версии: **7 FAIL / 2 PASS**, exit1. На candidate: **9 PASS**, exit0. Проверены cold null restart, initialized empty queue, active queue, normal setup, уничтожение во время init, уничтожение перед UI callback, распространение постороннего исключения, замена ожидающего callback, очистка listener после замены ReactContext. Baseline patch закреплён git ref; при дальнейших dependency changes harness требует явного обновления baseline ref, а не молча исправляет неизвестную установленную версию.

Перед принятием root должен согласовать обновление patched dependency/lockfile и native build, затем пройти framework/устройственные регрессии выше. До этого системный crash dialog нельзя объявлять устранённым на установленной сборке.

### Подготовка lockfile основным агентом

Выполнен `pnpm install --lockfile-only --offline --ignore-scripts` на pnpm9.15.0.
Diff lockfile ограничен тремя заменами patch hash TrackPlayer на
`o6bao4gjeve7crweg4j33vxlqm`; версии остальных пакетов не изменились.
Установленные node_modules и APK этим шагом не обновлялись. Повтор Kotlin
candidate harness: **9 PASS**. Это подготовка воспроизводимой установки,
не native build/acceptance. Peer warnings прежнего дерева зависимостей
сохранены; массовое обновление зависимостей не выполнялось.

Затем выполнена установка `pnpm install --frozen-lockfile --offline --ignore-scripts`.
На фактически установленном MusicService Kotlin harness дал **9 PASS**.
Настоящий `:react-native-track-player:compileDebugKotlin` с Android SDK36,
JDK17 и Gradle завершился успешно (9 s), проверяя полные imports/API,
а не только выделенные методы harness. Первый запуск остановился до компиляции
из-за отсутствующего ANDROID_HOME; повтор с существующим SDK прошёл.

Запущен `:app:assembleDebug` для arm64-v8a. Прежний APK SHA256
`371fbe3983c5b2bfb8154d4505082ffc2f3a9cda7670b1dd623a8212ca01c8db`
сохранён в `/private/tmp/narra-apk-before-recovery.CWM7Jp/app-debug.apk`.
На этом checkpoint APK ещё не установлен, framework/device acceptance
не выполнен; первичный SIGSEGV остаётся открытым.

Полный `:app:assembleDebug` завершился успешно (10 s, 824 tasks).
Новый APK SHA256 `2f7711135ebe5f1f03d377ea719f867b082fe0ff5c972a33a0028d08af9db8cf`,
package `com.mishanaer.readany.dev`, version1.3.5/code1 проверены aapt.
QA сохранил обе DB/WAL/SHM и crash buffer в
`/private/tmp/narra-before-native-update-pVpU3R`, затем `install -r` завершился
Success без удаления данных. До обновления: одна собственная книга,
CFI страницы2 и progress0.062136. Cold-runtime/device gate новой APK идёт;
установка сама по себе не подтверждает исправление crash или качества звука.
