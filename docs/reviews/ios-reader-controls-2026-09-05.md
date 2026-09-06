# Reader controls после TOC: toggle и отдельный auto-hide

## Изменение и регрессии

`use-reader-controls.ts` теперь отличает явное действие пользователя/TTS от
вступительной панели. Blur/focus не перезаписывает явный выбор и не запускает
для него таймер. Loading — временный override видимости выхода, не замена
сохранённого скрытого состояния; функциональный setter получает текущую
видимую величину. Автоскрытие без явного действия по-прежнему работает.

До изменения:6 FAIL/4 PASS в10 mounted tests. После:10 PASS; полный mobile
175 suites/1597 PASS; финальный TypeScript PASS. Первоначальная ошибка типов
в новых тестовых async act callbacks исправлена до freeze. Независимое ревью
подтвердило10 PASS и совместимость активных TTS setters. Android native и
успешная озвучка этим изменением не принимались.

## Исходное окружение и RED

Только isolated Air984D0C64-C0B2-4204-92A9-2C65519089E8, build36, LOCAL8082/18787; canonical wrapper, без импорта/AI/нативных сборок/правок runtime. Private `snapshotKeyHonorModalViews:false` использован исключительно для функционального доступа к TOC, не VoiceOver acceptance.

## Контроль ошибки ожидания QA

Run192300 `narra-air-reader-controls-after-toc`: после semanticClose16:23:22.624UTC кнопки уже видны на screenshot16:23:22.808. Ровно один center tap50%,50%16:23:22.809–23.736 скрывает их (снимок23.806). Последующий assertVisible FAIL — неверное ожидание теста, а не доказательство мёртвого ввода или самопроизвольного скрытия. Root event trace также подтвердил reader_tap.

Отдельный санкционированный run192412 `narra-air-reader-known-hidden-show`: assertNotVisible→один center tap→assertVisible PASS. Снимок `takeScreenshot/known-hidden-controls-visible.png` подтверждает реальные кнопки. Exactp7/2books сохранены. Таким образом обычное переключение visible→hidden→visible работает.

## Независимый RED: auto-hide после возврата без нажатий

Run192501 `narra-air-reader-toc-autohide-red` стартует с явно видимых кнопок→Book actions→TOC→semanticClose. [До ожидания](evidence/ios-reader-controls-2026-09-05/01-before-idle.png)16:25:11.617UTC кнопки видны. Затем только private JS ожидание по Date.now6s, фактически6.4s, **без жестов/нажатий/сети**. [После ожидания](evidence/ios-reader-controls-2026-09-05/02-after-idle.png)16:25:18.134 кнопки скрыты. AssertVisible Book actions FAIL; root получил evidence до исправления.

Это отдельный воспроизводимый UX: возврат из оглавления не сохраняет явно открытые пользователем controls. Данный RED не следует смешивать с правильным скрытием по center tap выше. Файлы actualflow `/private/tmp/narra-air-reader-toc-autohide-red.yaml`, wait `/private/tmp/narra-qa-wait-six-seconds.js`; raw artifacts `~/.maestro/tests/2026-09-05_192501/narra-air-reader-toc-autohide-red`.

Во всех проверках own27 `44da976d-50a6-4dd8-95e7-208dbeacc4cf` сохраняет CFI `epubcfi(/6/2!/4/2[chapter-1],/34/1:35,/38/1:252)`, progress0.21747735720599323; own30 и состав2books не менялись. После RED UI остановлен и передан root для исправления; приёмка исправления ещё не выполнена.

Cleanup: canonical hierarchy без `--config` завершён0, `/private/tmp/narra-controls-red-normal-hierarchy.txt`; run192618 actual XCTest log подтверждает `snapshotKeyHonorModalViews configured to value: (null)`. Приложение для cleanup не перезапускалось, нажатий не было.

## Native GREEN после исправления use-reader-controls

По stable GO выполнен canonical cold LOCAL launch нового candidate, без HMR-приёмки, без native rebuild. Flow `2026-09-05_192744/narra-air-reader-controls-green` завершился exit0. Private snapshotfalse применён только для функциональной навигации TOC; этот gate не закрывает стандартный AX/VoiceOver вопрос.

Precondition подтверждён фактическим выполнением: Book actions был скрыт, explicit center tap16:27:57.728–58.831UTC открыл controls **до первого TOC**, не только автоматический intro.

- После TOC Close [before screenshot] в raw artifacts16:28:05.125 показывает controls; спустя6.4s без ввода [кадр03](evidence/ios-reader-controls-2026-09-05/03-fixed-after-idle.png)16:28:11.646 показывает те же видимые кнопки, assertion PASS — исходный native RED стал GREEN.
- Один center tap16:28:11.758 скрывает controls, assertNotVisible PASS; следующий единственный tap16:28:13.314 возвращает их. Через дополнительные6s они остаются видимыми, assertion PASS.
- Второй semantic TOC→Close roundtrip и ещё6s без ввода также PASS: [кадр04](evidence/ios-reader-controls-2026-09-05/04-fixed-second-return.png)16:28:32.986. Оба опубликованных снимка лично просмотрены QA.

Actualflow `/private/tmp/narra-air-reader-controls-green.yaml`; raw `takeScreenshot/fixed-controls-after-close-before-wait.png`, `fixed-controls-after-six-seconds.png`, `fixed-controls-explicitly-hidden.png`, `fixed-controls-reopened-still-visible.png`, `fixed-second-toc-return-still-visible.png` в каталоге192744. Final inspector16:28:34.483: exactp7CFI/progress и2books неизменны.

Финальный canonical hierarchy без `--config` exit0, `/private/tmp/narra-controls-green-normal-hierarchy.txt`; run192845 actual XCTest log вновь подтверждает `configured to value: (null)`. Устройство оставлено без дальнейших UI действий. Принята узкая функциональность сохранения явно открытых controls при возврате из TOC и ручного toggle; долгий soak и остальные экраны этим прогоном не покрыты.
