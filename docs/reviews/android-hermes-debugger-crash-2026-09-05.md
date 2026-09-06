# Android LOCAL: падение в отладчике Hermes

## Доказательства

Crash 20:47:43.557 MSK, PID6286, mqt_v_js, SIGSEGV0x0 описан в
[клиентском прогоне](android-local-client-loop-2026-09-05.md).
Агент нашёл unstripped prefab-библиотеку; root независимо повторил
llvm-readelf, llvm-symbolizer и llvm-objdump без сборки или действий на устройстве.

BuildID библиотеки совпадает с crash: `634ec17cb80794f0651d6cbc61c77f5936fc3b63`.
Артефакт Gradle: `hermes-android-250829098.0.16-debug`, prefab arm64-v8a.

| PC | Символизация соответствующего бинарника |
| --- | --- |
| 0x36dbc8 | CodeBlock::getDebugSourceLocationsOffset, CodeBlock.cpp:190; inline getSourceLocation:201 → Debugger::getLocationForState:628 → sameStatementDifferentInstruction:619 → runUntilValidPauseLocation, Debugger.cpp:459 |
| 0x36d8ec | Debugger::runDebugger, Debugger.cpp:238 |
| 0x275510 | Interpreter::runDebuggerUpdatingState → interpretFunction |

Инструкция PC: `ldr x8,[x22]`; crash-register x22=0. Предыдущая загрузка
`ldr x22,[x19,#0x120]`. Ниже в стеке — JSI callback и TimerCallback::invoke.
Следовательно, это подтверждённый null dereference в debugger/source-location
пути, а не установленная ошибка SecureStore или чтения книги.

## Upstream и границы вывода

[Hermes issue2118](https://github.com/facebook/hermes/issues/2118) описывает
совпадающий стек и неинициализированный preStepState при асинхронной остановке.
Это сильная гипотеза для нашего случая, но точная последовательность CDP-команд
и отдельный минимальный repro ещё не установлены.

В [header тега текущей версии](https://github.com/facebook/hermes/blob/hermes-v250829098.0.16/include/hermes/VM/Debugger/Debugger.h)
getLocationForState разыменовывает codeBlock без null-проверки. Номера строк
публичного тега отличаются от DWARF бинарника: для точной локализации использованы
символы совпадающего BuildID, не предположение об идентичности исходников.

[PR2119](https://github.com/facebook/hermes/pull/2119) закрыт; GitHub API merged=false
не означает отсутствие исправления: Meta codesync и maintainer указывают landed
commits [2bfcfa1](https://github.com/facebook/hermes/commit/2bfcfa189dd667ba5cb1a28fd4755ddde7a1d2c9)
и [aa4dc53](https://github.com/facebook/hermes/commit/aa4dc53995121184faadceecf2d9d0a535f962c7).
Совместимый опубликованный артефакт для нашей Expo/RN ещё проверяется.

## Следующий шаг

Не повторять async CDP-диагностику на клиентском QA-устройстве. Продолжить
ограниченный клиентский прогон реальными UI-действиями без debugger и отдельно
выбрать совместимый Hermes fix с проверкой native-сборки. Зависимости не менялись,
патч в сторонний бинарник не внедрялся. Ни debugger fix, ни release stability
пока не приняты. AI/media-путь этим исследованием не проверялся.

## Кандидат обновления, ещё не установлен

Online `CI=1 pnpm exec expo install --check` рекомендует RN0.86.3 для SDK57.
Команда exit1 также перечислила двадцать других устаревших Expo-пакетов;
это не полная зелёная проверка зависимостей. Локальная таблица Expo57.0.14
ещё указывает0.86.2, поэтому важно различать её и актуальную online-проверку.

Подготовлены manifest/lockfile для RN0.86.3 и согласованного
@react-native/metro-config0.86.3: без явного metro-config resolver сохранял0.86.2
и выдавал новый peer-конфликт. После согласования этот конфликт исчез.
Остальные предупреждения Storybook/TypeScript не устранены этим обновлением.
Сравнение package keys lockfile: изменилось только семейство @react-native,
react-native и hermes-compiler (.16→.17), не Expo или backend-зависимости.

Использован Expo upgrading-expo. Выполнен только `pnpm install --lockfile-only
--ignore-scripts`; установленный RN по-прежнему0.86.2. Работающие Metro и APK
не обновлены, предыдущие1659 тестов не являются проверкой RN0.86.3.
Следующий обязательный этап — изолированная установка, тесты и native-build
с новым BuildID, затем проверка debugger и клиентского цикла.

## Изолированная JS-проверка кандидата

Создан отдельный worktree `/private/tmp/narra-rn0863-c48UDl` из tracked snapshot
1290cc809a3ef827488c8a07524f6a575e2a3e79; основной worktree не очищался.
Установка `pnpm install --frozen-lockfile --ignore-scripts` завершилась exit0.
Фактические версии из установленного дерева: RN0.86.3, Metro0.86.3,
hermes-compiler250829098.0.17. Node24.20.0.

- Reader assets: build успешен.
- Mobile: 178 файлов /1659 PASS, 5.68с.
- Core: 84 файла /675 PASS, 6.00с.
- Mobile TypeScript: exit0.
- Независимое сравнение lockfile подтвердило отсутствие посторонних изменений
  package records и сохранение всех существующих patches.

Основная рабочая папка по-прежнему использует RN0.86.2; её Metro/эмуляторы
не перенастраивались. Проверка бинарника Hermes и native-build ещё впереди.
Использование ignore-scripts при установке не является приёмкой всех native
lifecycle build-шагов. Временная копия сохранена для следующей проверки.

На той же новой установке root выполнил три native harness без Simulator:
Expo factory race (включая2000 callbacks и ThreadSanitizer), Fabric context
teardown и iOS SceneDelegate cold-link. Все exit0; baseline RED и patched GREEN
сохранены. Это проверка конкретных ObjC++/Swift патчей и startup-сценариев,
не сборка/запуск всего iOS-приложения и не тест нового Hermes на устройстве.

CI коммита73334722645c7ed2b427487f35d1ab3336fadbf3 завершился успешно:
[Regression33982637778](https://github.com/mishanaer/Narra/actions/runs/33982637778)
(mobile-and-core, expo-factory-native) и
[Gateway33982637773](https://github.com/mishanaer/Narra/actions/runs/33982637773)
(test-and-build). Publish-test-image пропущен; деплоя не было.

Android prebuild в изолированной копии завершился exit0; package.json не менялся.
Использованы development variant, EXPO_NO_DOTENV=1 и --no-install, без EAS.
Есть предупреждение о недостающем expo-system-ui для automatic theme, его
влияние на тему ещё не проверено. Запущен assembleDebug только arm64-v8a,
Java17, max-workers2/no-parallel/Xmx2g; APK/новый BuildID пока не подтверждены.

## APK и установка на отдельный Android QA

assembleDebug завершился exit0:824 задачи,3м55с. APK114987571bytes,
SHA256 `2473951adb3c5c3b8b960682488949a97153580b1a698896ee10fc1f10760a0c`.
Пакет com.mishanaer.readany.dev,1.3.5/versionCode1, min24/target36,
фактический ABI только arm64-v8a. Root проверил SHA/aapt и непосредственно
из APK прочитал Hermes BuildID `ad8f6a3c901d0e6d9eab8b2c375d703499481521`.

На5556 подтверждены AVD Narra_LOCAL_QA_20260905, прежний versionCode1 и
совпадение сертификатов старого/нового APK. `adb install -r` завершился Success,
без удаления данных/downgrade. TEST5554 и iOS не менялись.

Первый запуск на отдельном Metro8083 успешен (COLD1071мс, не TTI), но bootstrap
выявил обращение к TEST backend и ошибку cover502. Это ошибка QA-запуска:
root использовал обычные EXPO_PUBLIC_NARRA_* вместо предусмотренных проектом
NARRA_LAUNCH_* overrides. Несмотря EXPO_NO_DOTENV=1, virtual/env включал
tracked dotenv. UI-прогон остановлен до taps, приложение force-stopped.
Нельзя утверждать, что первый запуск был LOCAL или что он не сделал сетевых
запросов к TEST. Получение нового контента/успешная генерация не подтверждены.

Старый Metro8083 остановлен с подтверждённым завершением; новый запущен с
reserved launch overrides. До повторного открытия скачан полный Android JS
bundle и выполнен существующий env-only inspector: effectiveProfile строго
http://127.0.0.1:18787 /development/installation, несмотря virtualEnvironment=test.
Приложение повторно открыто explicitlocalhost8083. Нативная клиентская проверка
и воспроизведение debugger-crash с новым Hermes ещё не завершены.

После исправления запуска actual runtime лог подтвердил backend host127.0.0.1,
actualdevelopment, versionlocal-core-loop-readiness, ok=true. Новый клиентский
прогон выявил startup mismatch: My books выделена, но показывается пустой каталог;
повторный тап выбранной вкладки не помогает. Root лично просмотрел screenshot.
Один цикл Popular→My books восстановил own27card6%; затем Reader→Back→Reader
прошёл, root сравнил screenshots текста до/после. Потеря книги не подтверждена;
подтверждён рассинхрон pager, поэтому startup-приёмка остаётся открытой.
К21:11:15 crash buffer содержит только прежний20:47:43. CDP не использовался,
exactCFI не проверялся; debugger-crash этим не воспроизведён и не закрыт.
