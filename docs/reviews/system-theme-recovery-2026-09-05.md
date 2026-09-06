# «Системная» тема после ручной тёмной/светлой

## Подтверждение

Android: после физического Dark → System поле действительно показывало
System и picker закрылся, но Profile/Notes оставались тёмными при
`adb cmd uimode night=no`. Cold reload возвращал светлую тему. Старое имя
снимка `settings-system-restored.png` означает выбранный режим, не успешное
восстановление светлой палитры; это не только ошибка UI-драйвера.

Read-only [native probe](evidence/android-2026-09-05/theme-system-runtime-before.json)
показал RN Appearance `dark`, активный Uniwind `config.native` —
`current=dark, adaptive=false`. Отдельный singleton `config.common` имеет
`adaptive=true`, но это не тот экземпляр, которым пользуются native hooks.

## Причина и исправление

PanelUI `useThemeMode` предлагает только конкретные light/dark. Старый
bridge передавал туда разрешённое `isDark`, теряя выбранный пользователем
режим system. В установленном Uniwind конкретный `setTheme` также вызывает
RN `Appearance.setColorScheme`, то есть принудительно меняет значение,
которое приложение затем читает как системное. Возникает обратная связь.

Изменён только `panelui-theme-bridge.tsx`: выбранный appMode=system включает
поддерживаемый `Uniwind.setTheme('system')`, если adaptive режим был выключен.
Это снимает override Appearance. Явный light/dark, напротив, закрепляет
override даже при совпадении с текущей системной палитрой. Реактивный
`hasAdaptiveThemes` и сравнение режима предотвращают повторные установки.
ThemeContext, SecureStore contract, deslop tokens и generated CSS не менялись.
Root просмотрел установленный runtime библиотеки и согласовал минимальный hunk.

## Проверки и граница

Настоящие ThemeProvider/bridge, PanelUI hooks, Uniwind listener/useUniwind,
native config subclass и common implementation исполняются вместе в mounted
тесте. Подменены только native Appearance, SecureStore и renderer/style-store
границы; деслоп-палитры настоящие. OS light: Dark→System и OS dark:
Light→System были **2 RED**, затем GREEN. Всего **7 PASS**, включая OS change
в System, независимость явных режимов от ОС и отсутствие лишних override
при повторном render. С соседними picker/statusbar/reader theme — **22 PASS**.
App TypeScript и Biome двух изменённых файлов — exit 0.

Нативный Dark→System без перезапуска принят на обеих платформах ниже.
Модель Appearance не подменяет эту проверку реального notification timing.
Предыдущие прогоны заменены итоговым final-v5 после общего runtime freeze;
числа и экспорты приведены в [отчёте кампании](release-campaign-2026-09-05.md).

## Native AFTER: iOS

На свежем JS выбранная явная Dark была переключена через настоящий Profile
picker в System. Закрытый picker показывает System, экран сразу светлый;
последующий общий блокнот также светлый. Перезапуск между выбором System и
светлым результатом не выполнялся. Исходная пользовательская настройка System
восстановлена. [Нативный снимок](evidence/ios-2026-09-05/system-theme-restored-final.png).

## Native AFTER: Android

После Dark→System без перезапуска реальный RN Appearance вернул `light`,
Uniwind — `currentTheme=light, adaptive=true`; OS night mode оставался `no`.
Следующие Notes и Library светлые. Первый Profile screenshot был переходным;
он не выдаётся за окончательное состояние, latency переключения не измерена.
[Runtime](evidence/android-2026-09-05/theme-system-runtime-after.json),
[Notes](evidence/android-2026-09-05/theme-system-light-notes-after.png),
[Library](evidence/android-2026-09-05/theme-system-library-after.png).
