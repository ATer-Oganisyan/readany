# iOS: уведомление скрывало интерфейс из accessibility tree

**Итог: третий кандидат принят для Library ↔ Reader на iOS Simulator.**
Уведомление видно вместе с Reader controls, semantic Cancel сработал, уведомление
исчезло из UI/AX/JS store, соединение с fixture закрылось, точная позиция сохранена.
Это не полная VoiceOver-приёмка, не проверка всех modal routes и не исправление
перекрытия текста. Ниже сохранена история отвергнутых вариантов.

**Первый кандидат не принят нативно.** Отключение модальности overlay
вернуло AX-доступ к библиотеке, но внутри Reader, открытого как fullScreenModal,
видимый Cancel оказался недоступен через AX. Не считать JS GREEN полноценным
исправлением; следующий вариант требует уведомления внутри активного modal host.

Baseline: [зависший импорт во время чтения](ios-stalled-import-reading-2026-09-05.md).
Карточка книги оставалась видна и реагировала на физическое нажатие, но её имени
не было в AX hierarchy, пока показывались Downloading/Cancel.

## Причина и изменение

Установленный sonner-native использует FullWindowOverlay без параметров.
В react-native-screens native/codegen значение accessibilityContainerViewIsModal
по умолчанию true. Hit-testing пропускает физические нажатия независимо от этого
флага: поэтому coordinate tap работал, а semantic tap — нет.

App передаёт стабильный компонент ToastOverlay через предусмотренный библиотекой
ToasterOverlayWrapper. На iOS он явно задаёт
`unstable_accessibilityContainerViewIsModal={false}`. Уведомление остаётся поверх
экранов; его children и Cancel не подменяются. На Android wrapper возвращает
children без нового native overlay. Обновления зависимостей, native patch,
пересборки и изменения дизайн-токенов не потребовались.
Это описание первого кандидата, а не принятого полного клиентского пути.

## Проверки

Mounted regression исполняет установленный JS-адаптер React Native Screens и
проверяет параметр на границе native component, а не строку исходника.
Baseline default не задаёт false; исправление задаёт false, Cancel callback
вызывается, Android остаётся без overlay. RED→GREEN, три теста PASS.
Root полный mobile: **174 suites / 1590 PASS**. Авторский связанный набор:
75 PASS; TypeScript PASS. Нативная AX-проверка выполняется отдельно и не заменяется
этими JS-тестами.

## Ограничение

Исправляется модальность доступности, **не положение уведомления**. Во время
долгой загрузки оно пока перекрывает нижние строки Reader. Нужен отдельный
неперекрывающий статус в layout с доступной отменой; перестановка того же toast
наверх не будет считаться полноценным решением. Полный VoiceOver-сценарий,
включая порядок фокуса и системные sheets, также остаётся отдельной приёмкой.

## Второй кандидат: слой внутри Reader

После native FAIL первого варианта прежнее оформление выделено в StyledToastHost.
Единый snapshot активного маршрута выбирает один host: root либо конкретный
Reader по route.key. Стабильный ReaderWithToastHost оборачивает ReaderScreen,
включая его ранние loading/error возвраты. Внутри Reader используется обычный
локальный Toaster без FullWindowOverlay; native fullScreenModal не меняется.
Корневой host сохраняет немодальный overlay для библиотеки.

Прежний default-channel переносит тот же toast ID, callback отмены и остаток
таймера. Mounted tests исполняют установленный sonner store, подменяя rendering
Toaster: два сохранённых Reader не дают два host, Cancel отменяет исходный
AbortController, закрытое сообщение не воскресает, finite deadline не начинается
заново. Это проверка состояния/передачи, не UIKit accessibility traversal.

Scope второго кандидата — Library ↔ Reader. ReaderTOC/formSheet, BookChat поверх
modal stack и системные модальные окна требуют отдельной проверки владельца
уведомлений. Их доступность этим изменением не объявляется исправленной.

Второй кандидат также не принят: на чистом новом процессе приложение находилось
в Reader, React DevTools показал ровно один локальный Toaster и правильный route.key,
но loading toast был **невидимым уже до Cancel**, оставаясь в AX tree. Semantic tap
не доказывает нажатие доступной клиенту кнопки. Отдельная попытка с Fast Refresh
исключена. Позднее пустые JS store и AX tree совпали, поэтому постоянный native ghost
не подтверждён; успешная отмена второго кандидата не принята. Следующий проверяемый
вариант — явный полноэкранный локальный слой над содержимым Reader с box-none hit
testing, а не дальнейшее изменение модальности.

## Третий кандидат и принятый native gate

Локальный host получил явную native-плоскость: absoluteFill, zIndex9999,
collapsable=false, pointerEvents=box-none. Это задаёт размеры/порядок для абсолютного
Positioner Sonner; касания вне карточки пропускаются к Reader. Корневой host,
default-channel, callback, таймеры и оформление не менялись.

Непрерывный Maestro flow `2026-09-05_183226/narra-air-ax3-combined` завершился0:

- Add15:32:42.911UTC → semantic book tap → одновременно видимые Reader controls
  и Downloading/Cancel, также доступные в AX tree.
- Cancel15:32:53.331–54.852 → notVisible15:32:55.452, через12.5с после Add,
  не по90-секундному timeout fixture.
- Read-only15:33:00.934: две книги, own27/p7 и точный CFI без изменения.
- 15:33:01: у fixture8099 нет установленного соединения Narra, только LISTEN.
- Root самостоятельно проверил before/after кадры и Air CDP15:33:15.132:
  route=Reader, настоящий sonner store toasts=[].

До этого первая попытка третьего кандидата оборвалась на неподдержанном абсолютном
пути screenshot, а отдельный запуск Cancel завис на старте Maestro. Они не засчитаны;
own Java-процесс остановлен, затем выполнен описанный непрерывный прогон с
относительными путями. Данные приложения не сбрасывались.

Финальный полный mobile-прогон root после native gate: **175 suites / 1591 PASS**;
TypeScript PASS, независимый review PASS. Контракт шрифта перенесён из поиска строки
в App в mounted-проверку StyledToastHost; уменьшение общего числа на1 относительно
промежуточных1592 не является удалением проверки поведения.
