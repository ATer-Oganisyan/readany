const EVENTS = new Set([
  "app_started",
  "app_state",
  "js_stall",
  "server_start",
  "server_probe",
  "server_recovered",
  "server_failed",
  "reader_open",
  "reader_ready",
  "reader_loaded",
  "reader_error",
  "reader_retry",
  "reader_closed",
  "reader_foreground",
  "reader_panels",
  "reader_tap",
  "reader_relocated",
  "webview_terminated",
  "webview_error",
  "webview_unresponsive",
  "webview_responsive",
  "logs_share_closed",
  "logs_share_failed",
]);
const BOOLEAN_FIELDS = new Set([
  "ok",
  "restart",
  "fallback",
  "loading",
  "toc",
  "settings",
  "notebook",
  "translation",
]);
const NUMBER_FIELDS = new Set(["durationMs", "attempt", "code", "delayMs", "build"]);
const ENUM_FIELDS: Record<string, ReadonlySet<string>> = {
  state: new Set(["active", "inactive", "background", "unknown", "extension"]),
  reason: new Set([
    "transport",
    "timeout",
    "missing_file",
    "aborted",
    "unknown",
    "manual",
    "automatic",
    "foreground",
  ]),
  format: new Set(["epub", "pdf", "mobi", "azw", "azw3", "fb2", "cbz", "txt", "other"]),
};

export interface DiagnosticEntry {
  at: string;
  event: string;
  data: Record<string, string | number | boolean>;
}

/** Allow-list, not redaction: raw errors, URLs, IDs, text and tokens never enter the journal. */
export function diagnosticEntry(
  event: string,
  data: Record<string, unknown> = {},
  now = Date.now(),
): DiagnosticEntry | null {
  if (!EVENTS.has(event)) return null;
  const safe: DiagnosticEntry["data"] = {};
  for (const [key, value] of Object.entries(data)) {
    if (BOOLEAN_FIELDS.has(key) && typeof value === "boolean") safe[key] = value;
    else if (NUMBER_FIELDS.has(key) && typeof value === "number" && Number.isFinite(value)) {
      safe[key] = Math.max(-1_000_000, Math.min(86_400_000, Math.round(value)));
    } else if (typeof value === "string" && ENUM_FIELDS[key]?.has(value)) safe[key] = value;
  }
  return { at: new Date(now).toISOString(), event, data: safe };
}

export function diagnosticErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/timed? ?out|timeout/i.test(message)) return "timeout";
  if (/load failed|failed to fetch|network|file server is unavailable/i.test(message))
    return "transport";
  if (/not found|enoent/i.test(message)) return "missing_file";
  if (/abort/i.test(message)) return "aborted";
  return "unknown";
}

const MAX_ENTRIES = 500;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function createDiagnosticJournal(io: {
  read: () => Promise<string>;
  write: (value: string) => Promise<void>;
  now?: () => number;
}) {
  const now = io.now ?? Date.now;
  let entries: DiagnosticEntry[] = [];
  let loaded = false;
  let queue: Promise<unknown> = Promise.resolve();
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function compact() {
    const cutoff = now() - MAX_AGE_MS;
    entries = entries.filter((entry) => Date.parse(entry.at) >= cutoff).slice(-MAX_ENTRIES);
  }

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = queue
      .catch(() => {})
      .then(async () => {
        if (!loaded) {
          loaded = true;
          try {
            const parsed: unknown = JSON.parse(await io.read());
            if (Array.isArray(parsed)) {
              entries = parsed.slice(-MAX_ENTRIES).flatMap((entry) => {
                if (
                  !entry ||
                  typeof entry !== "object" ||
                  typeof entry.event !== "string" ||
                  typeof entry.at !== "string" ||
                  !Number.isFinite(Date.parse(entry.at))
                )
                  return [];
                const safe = diagnosticEntry(
                  entry.event,
                  entry.data && typeof entry.data === "object" ? entry.data : {},
                  Date.parse(entry.at),
                );
                return safe ? [safe] : [];
              });
            }
          } catch {
            /* Missing or interrupted previous write must not block reading. */
          }
        }
        compact();
        return operation();
      });
    queue = pending;
    return pending;
  }

  const flush = () =>
    serialize(async () => {
      clearTimeout(timer);
      timer = undefined;
      if (!dirty) return;
      try {
        await io.write(JSON.stringify(entries));
        dirty = false;
      } catch {
        /* Keep the in-memory journal if storage is unavailable. */
      }
    });

  return {
    record(event: string, data: Record<string, unknown> = {}) {
      const entry = diagnosticEntry(event, data, now());
      if (!entry) return;
      void serialize(async () => {
        entries.push(entry);
        compact();
        dirty = true;
        if (!timer)
          timer = setTimeout(() => {
            void flush();
          }, 250);
      }).catch(() => {});
    },
    flush,
    snapshot: () =>
      serialize(async () => entries.map((entry) => ({ ...entry, data: { ...entry.data } }))),
  };
}
