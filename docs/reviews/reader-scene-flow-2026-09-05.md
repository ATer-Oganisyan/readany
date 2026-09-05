# Встроенная сцена: естественный поток вместо обязательной новой страницы

## Продуктовый контракт

Это согласованное UX-изменение старого поведения, не только исправление ошибки.
До аудита комментарий reader и `scene-square-contract.test.ts` явно требовали
новую колонку перед каждой сценой. Приёмка теперь требует целый квадрат сразу
после исходного абзаца; перенос — только если квадрат не помещается в остатке.
Запрещены разрыв сцены, перекрытие текста и перенумерация CFI исходной книги.
Square clamp, `break-inside: avoid`, размеры, отступ 24 px и CFI filter сохранены.

## Подтверждённый baseline

Android native WebView, 2026-09-05: реальный layout probe из
`packages/app-expo/scripts/qa/reader-scene-flow.mjs` выполнен Android QA при
открытом оригинальном MOBI. Он использует `sceneSlotStyleText()` установленного
reader в изолированных временных iframe; книжный DOM, selection и CFI не меняет.
Это проверка реального CSS layout, но не замена визуальному тесту всей страницы.

Baseline reader.html SHA-256:
`1ebc30857fef56915fc0725fbd8307d56eb9c0efa931fbb4dc6307ff9da253c9`.
Копия старого bundle: `/private/tmp/narra-reader-before-natural-flow.html`.
Reader build metadata SHA-256:
`0c6c96a6def696b03836edc2ac99c6b6b047c3a325786a2830d8713ab6193c57`.
Сырые измерения: [scene-flow-before.json](evidence/android-2026-09-05/scene-flow-before.json).

| Участок | Старый layout | Кандидат в том же WebView |
| --- | --- | --- |
| 320×640, 4 строки по 30 px | Сцена x=340, y=0: следующая колонка; 520 px пустоты после текста | Сцена x=0, y=120, 320×320; следующий текст y=464 |
| 320×480, 8 строк | Сцена x=340, y=0 | То же: 320×320 не помещается в остатке 240 px |
| 740×260, 1 строка | Сцена x=1012, y=0, 236×236 | То же: квадрат ограничен высотой страницы |

Во всех случаях сцена имеет один фрагмент. Изначальный probe ошибочно пометил
следующую колонку landscape как overlap: следующий текст x=1520, сцена заканчивается
на x=1248. Проверка исправлена на пересечение прямоугольников по обеим осям;
этот ложный сигнал не используется как доказательство бага приложения.

## Проверки и оставшиеся ограничения

Удалены только две принудительные `break-before` декларации. Обновлены комментарий,
старый source contract и настоящий Foliate layout runner
`scripts/verify-reader-scene-layout.mjs`. Новый probe проверяет установленный
bundle как `current`, старое правило как `forced` и естественный поток как `flow`.
До пересборки `current` дал ожидаемый RED на участке с четырьмя строками.

Локально: 39 связанных reader/scene tests PASS; Biome и синтаксис QA-скриптов PASS.
Эти unit/source проверки сами по себе не принимают layout.
После cold reload Android повторил probe в настоящем WebView: `current` GREEN,
`passed=true`, `errors=[]`. Для четырёх строк сцена x=0, y=120, 320×320,
следующий текст y=464; insufficient-space и landscape также PASS.
Артефакт: [scene-flow-after.json](evidence/android-2026-09-05/scene-flow-after.json).
Проверенный natural-flow reader.html SHA-256:
`35646e544db9c7c789329123d7aed9045cc3fcce706ea62a1fa79ed79fa66314`.

Это подтверждает реальную геометрию установленного CSS. Ещё нужны визуальный
проход участка со сценой, возврат к чтению и проверка сохранённого CFI именно
на этом участке. iOS baseline со свободным остатком
сохранён root: `.maestro/tests/2026-09-05_002335/narra-audit-ios-fast-paging/takeScreenshot/controls-immediate.png`.
Полный WebKit/Chromium Foliate runner в этом этапе не запускался.
