# Озвучка при нестабильной сети: повторное исследование

Дата: 25 сентября 2026. Исследование текущего checkout; номер и платформа сборки тестера неизвестны. Runtime-код не изменялся.

## Что подтверждено

### 1. Ожидание следующего аудио показывается как воспроизведение

`packages/app-expo/src/lib/platform/track-player-edge-player.ts`, `_markQueueStarved()` не сообщает интерфейсу об ожидании. На iOS добавляет секундный WAV тишины; событие Playing снова сообщает обычное playing. На Android также нет отдельного уведомления об исчерпании буфера.

`packages/app-expo/src/components/reader/tts/useTTSNativePlayer.ts`, `useTTSBuffering()` распознаёт только нативные Buffering/Loading. Ожидание запроса синтеза происходит вне нативного плеера: тот воспроизводит локальные WAV или уже завершил очередь. Поэтому сетевое ожидание может не включить индикатор загрузки.

Управляемый тест: первые три фрагмента готовы, следующие запросы остаются pending; событие завершения третьего фрагмента добавляет тишину, последнее состояние UI остаётся playing. Подтверждён механизм рассогласования, а не исходный инцидент на телефоне.

### 2. На iOS служебный трек ошибочно считается фрагментом книги

`PlaybackQueueEnded.track` — индекс очереди, а обработчик передаёт его как индекс текста в `_handlePlaybackEnded()` → `_markQueueStarved()`. Контракт библиотеки: https://github.com/doublesymmetry/react-native-track-player/blob/v4.1.2/src/interfaces/events/PlaybackQueueEndedEvent.ts

Управляемый тест: после реальных фрагментов 0–2 служебная тишина занимает позицию 3. Завершение тишины меняет внутренний индекс текста с 2 на 3, хотя текст 3 не звучал. Следующее восстановление выбирает индекс current+1, создавая риск пропуска. Это не объяснение отката назад, а отдельный оставшийся дефект того же сценария.

### 3. Известный откат к началу очереди уже исправлен в репозитории

Коммит `477a0731` от 22 сентября, PR #151: после аварийной остановки toggle теперь вызывает resume от текущего фрагмента, а не play всей сохранённой очереди. Сбой синтеза сохраняет подготовленное аудио; неудачное восстановление native переводит плеер в паузу.

Существующие тесты этих веток проходят. Наличие исправления у тестера не установлено. Прежнее исследование `docs/tts-stops-research-2026-09-22.md` прямо отмечало, что новая тестерская сборка тогда не выпускалась; последующие публикации в рамках этой проверки не проверялись.

В актуальном коде есть и другие пути перезапуска: resumeFromReader начинает с видимой страницы, если её CFI изменился после паузы; пауза в состоянии loading отменяет сессию, после чего возобновляется текущий фрагмент с начала. Их наличие не доказывает возврат именно к исходной точке тестера. Полный описанный откат в текущей версии не воспроизведён.

## Минимальное исправление по Ponytail

1. Передавать из существующего плеера отдельный признак ожидания синтеза/исчерпания буфера в UI; снимать его при начале реальной речи. Не полагаться только на нативный Buffering.
2. Не заменять playing на loading механически: store.pause() при loading уничтожает активную очередь. Ожидание следующего фрагмента должно позволять паузу без потери очереди и позиции.
3. Считать текущий текст по ID реального аудиотрека, исключая служебную тишину; индекс очереди не использовать как индекс текста.

Новые библиотеки, новый плеер и увеличение буфера до установления причины не нужны. Для отката сначала сопоставить номер сборки тестера с #151; если исправление уже присутствует — воспроизвести его конкретную последовательность с записью индекса текста, ID трека и причины перезапуска.

## Проверки и ограничения

37 тестов прошли: копия существующих тестов book-tts-player с двумя временными исследовательскими пробами, use-resume-from-reader, use-reader-tts-recovery. Вывод: `/tmp/narra-weak-network-research.log`. Временный файл удалён после прогона; ниже сохранён код проб для повторения в конце book-tts-player.test.ts. Пробы фиксируют дефектное текущее поведение, поэтому зелёный результат не означает исправления.

На физическом устройстве, при настоящем переключении сети и блокировке экрана не проверялось. Связь с конкретной сборкой бета-тестера не установлена. Изменён только этот отчёт.

## Исследовательские пробы

```ts
// Research probes: characterize existing defects, not desired behavior.
it("RESEARCH: waiting for synthesis still reports playing", async () => {
  runtime.synth.mockImplementation((text: string) => Number(text) < 3
    ? Promise.resolve(`file:///${text}.wav`) : new Promise(() => {}));
  const states = vi.fn();
  player.onStateChange = states;
  await player.speak(["0", "1", "2", "3", "4", "5"], DEFAULT_TTS_CONFIG);
  await flush();
  for (const callback of runtime.listeners.get("track") ?? []) callback({track: {id: "tts-chunk-2"}});
  for (const callback of runtime.listeners.get("end") ?? []) callback({track: 2});
  await flush();
  expect(runtime.queue.some(t => t.id.startsWith("tts-silence-"))).toBe(true);
  expect(states).toHaveBeenLastCalledWith("playing");
});
it("RESEARCH: ending silence advances text cursor beyond spoken text", async () => {
  runtime.synth.mockImplementation((text: string) => Number(text) < 3
    ? Promise.resolve(`file:///${text}.wav`) : new Promise(() => {}));
  await player.speak(["0", "1", "2", "3", "4", "5"], DEFAULT_TTS_CONFIG);
  await flush();
  for (const callback of runtime.listeners.get("track") ?? []) callback({track: {id: "tts-chunk-2"}});
  for (const callback of runtime.listeners.get("end") ?? []) callback({track: 2});
  await flush();
  expect(runtime.queue[3].id.startsWith("tts-silence-")).toBe(true);
  for (const callback of runtime.listeners.get("end") ?? []) callback({track: 3});
  await flush();
  expect((player as unknown as {_currentIndex: number})._currentIndex).toBe(3);
});

```
