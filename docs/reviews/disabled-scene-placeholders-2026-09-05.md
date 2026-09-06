# Пустые предложения сцен при недоступном backend

## Нативный дефект

iOS: собственная новая FBZ, переход с текстовой страницы 11 на страницу 12
показывал только idle pixel placeholder, без подписи и доступного действия.
Следующее перелистывание открывало текст главы 2. Это не зависший запрос
генерации и не сбой его deadline: никакая генерация ещё не начиналась.
Before root: `/private/tmp/narra-audit-ios-boundary-after-tap.png`.
Независимый reviewer просмотрел снимок.

Причина: Reader `onRelocate` продолжал считать предложения и посылать
`insertSceneSlot`, несмотря на `backendSceneEnabled=false`. WebView принимал
сообщение, создавал `idle` блок и скрывал его action из-за `_sceneSlotsEnabled`.
Так чтение получало дополнительные неиспользуемые пустые страницы.

## Ограниченное исправление

- Пока backend не готов, настоящий `advanceSceneSuggestion` получает interval 0:
  текущая позиция отслеживается, накопленные перелистывания обнуляются. После
  восстановления готовности нет накопленной очереди предложений.
- WebView проверяет `_sceneSlotsEnabled` перед новой вставкой, включая запоздалое
  сообщение RN. Изначальное значение остаётся false до готовой конфигурации.
- `configure(false)` удаляет только несохранённые `idle` DOM-предложения,
  появившиеся до обновления конфигурации. Снимаются pixel loader и observer.
  Сохранённые anchors, изображения и состояния loading/error не удаляются;
  восстановление saved/requested scenes продолжает работать при disabled.
- CFI/checkpoint/сцены в store не переписываются. Никаких новых стилей или UI
  компонентов. Удаляемый transient node уже `cfi-inert`; фактический reflow и
  сохранность видимого текста всё равно требуют native AFTER.

## Доказательства и границы

`scene-availability.test.ts` исполняет actual Reader relocation statements с
настоящим счётчиком и actual WebView insert/configure/remove/restore helpers.
Первый прогон: **5 RED / 1 PASS**; после исправления и positive restore control —
**7 PASS**. В RED 20 disabled relocates посылали три insert, в GREEN — ноль.
Проверены initial disabled, late message, selective cleanup/disposal, no backlog,
recovery и сохранение anchors. DOM/layout boundary здесь подставлен; это не
нативная проверка отрисовки или расположения текста.

Независимый reader review новых блокеров не нашёл. App `tsc --noEmit` — PASS;
соседние scene наборы — 58 PASS, asset + availability — 16 PASS. Выполнена
сборка reader HTML SHA256
`c11f24dcfc898489d8c0699a6729403b84e55826c6c0512c2710f784e224c03e`;
PDF binary не изменился.

Android AFTER принят на указанном новом asset (native MD5
`ebc454daf48943c10a445fdb13ea6ec2`): **10/10 физических перелистываний** дали
новые CFI; во всех 12 snapshots (initial + 10 turns + settled) `sceneSlots=[]`.
После Back → Library → reopen совпали точный CFI
`epubcfi(/6/2!/4,/162/1:251,/168/1:113)` и 300 наблюдаемых символов, slots пусты.
Независимо сверены [turns](evidence/android-2026-09-05/scenes-disabled-turns.jsonl)
и [reopen](evidence/android-2026-09-05/scenes-disabled-reopen.jsonl).
Это disabled/unbound fixture без saved images; сохранение настоящего ранее
сгенерированного изображения этим native сценарием не доказано.

Root повторяет настоящий iOS loop после сборки. До его AFTER изменение не
объявляется принятым на обеих платформах. Этот дефект также объясняет, почему
предыдущий termination probe мог наблюдать collapsed CFI страницы со сценой;
сам по себе такой адрес не доказывает потерю текстового прогресса.
