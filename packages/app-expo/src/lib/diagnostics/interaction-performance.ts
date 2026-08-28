/** Opt-in, local-only transition diagnostics. Never records content, ids or navigation params. */
const SAMPLE_MS = 50;
const MAX_SAMPLES = 900;
const MAX_EVENTS = 200;

export type RenderCounter =
  | "search.screen"
  | "search.shelf"
  | "search.results"
  | "search.results.build"
  | "catalog.group"
  | "catalog.category"
  | "catalog.card"
  | "catalog.perspective"
  | "chats.screen"
  | "chats.page.build"
  | "chats.row";

export type InteractionMark =
  | "search.focus"
  | "search.blur"
  | "search.input"
  | "category.open"
  | "category.layout"
  | "catalog.metadata.request"
  | "catalog.metadata.read"
  | "catalog.cover.complete";

interface Capture {
  startedAt: number;
  previous: number;
  counters: Partial<Record<RenderCounter, number>>;
  events: { name: InteractionMark; atMs: number }[];
  samples: { atMs: number; delayMs: number }[];
}

let capture: Capture | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;

export function countRender(name: RenderCounter): void {
  if (capture) capture.counters[name] = (capture.counters[name] ?? 0) + 1;
}

export function markInteraction(name: InteractionMark): void {
  if (capture && capture.events.length < MAX_EVENTS)
    capture.events.push({ name, atMs: performance.now() - capture.startedAt });
}

function stop() {
  clearInterval(interval);
  clearTimeout(watchdog);
  interval = undefined;
  watchdog = undefined;
  const result = capture;
  capture = undefined;
  return result
    ? {
        durationMs: performance.now() - result.startedAt,
        sampleIntervalMs: SAMPLE_MS,
        counters: result.counters,
        events: result.events,
        samples: result.samples,
      }
    : null;
}

function start() {
  stop();
  const now = performance.now();
  capture = { startedAt: now, previous: now, counters: {}, events: [], samples: [] };
  interval = setInterval(() => {
    if (!capture || capture.samples.length >= MAX_SAMPLES) return;
    const time = performance.now();
    capture.samples.push({
      atMs: time - capture.startedAt,
      delayMs: Math.max(0, time - capture.previous - SAMPLE_MS),
    });
    capture.previous = time;
  }, SAMPLE_MS);
  watchdog = setTimeout(stop, SAMPLE_MS * MAX_SAMPLES);
  return { sampleIntervalMs: SAMPLE_MS, maximumDurationMs: SAMPLE_MS * MAX_SAMPLES };
}

// No timer, persistence, telemetry or global API in production; explicitly start each Debug sample.
if (typeof __DEV__ !== "undefined" && __DEV__) {
  Object.assign(globalThis, { __NARRA_PERF__: { start, stop } });
}
