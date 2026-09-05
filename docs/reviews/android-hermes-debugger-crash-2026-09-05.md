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
