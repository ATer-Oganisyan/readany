/**
 * Privacy contract for product analytics emitted by the Expo client.
 *
 * Values are deliberately coarse. Book text, titles, prompts, responses,
 * filenames, URLs and media identifiers do not belong in this contract.
 */
export const ANALYTICS_SCHEMA_VERSION = 1 as const;

export const ANALYTICS_EVENTS = [
  "app_opened",
  "app_closed",
  "book_opened",
  "reading_session_qualified",
  "book_analysis_started",
  "book_analysis_completed",
  "book_analysis_failed",
  "character_opened",
  "chat_opened",
  "bookmark_added",
  "note_added",
  "media_job_enqueued",
  "media_job_started",
  "media_job_completed",
  "media_job_failed",
  "tts_first_audio_ready",
  "tts_playback_started",
  "tts_playback_abandoned",
  "answer_feedback_submitted",
  "app_version_seen",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];
export type SafeAnalyticsValue = string | number | boolean;

export interface AnalyticsEvent {
  eventId: string;
  name: AnalyticsEventName;
  occurredAt: string;
  sessionId: string;
  properties: Record<string, SafeAnalyticsValue>;
  schemaVersion: typeof ANALYTICS_SCHEMA_VERSION;
}

export const ESSENTIAL_ANALYTICS_EVENTS = new Set<AnalyticsEventName>([
  "app_opened",
  "app_closed",
  "book_opened",
  "reading_session_qualified",
  "app_version_seen",
]);

const EVENT_PROPERTIES: Record<AnalyticsEventName, ReadonlySet<string>> = {
  app_opened: new Set(["app_version", "os_major", "channel"]),
  app_closed: new Set(["duration_seconds"]),
  book_opened: new Set(["book_kind"]),
  reading_session_qualified: new Set(["book_kind", "duration_seconds", "duration_bucket"]),
  book_analysis_started: new Set(["analysis_version", "origin"]),
  book_analysis_completed: new Set([
    "analysis_version",
    "character_count_bucket",
    "duration_bucket",
    "pov",
    "confidence_bucket",
    "origin",
  ]),
  book_analysis_failed: new Set(["analysis_version", "stage", "safe_error_code", "origin"]),
  character_opened: new Set(["feature"]),
  chat_opened: new Set(["feature"]),
  bookmark_added: new Set(["feature"]),
  note_added: new Set(["feature"]),
  media_job_enqueued: new Set([
    "job_type",
    "provider",
    "model",
    "quality",
    "queue_depth_bucket",
    "origin",
  ]),
  media_job_started: new Set(["job_type", "queue_wait_bucket", "origin"]),
  media_job_completed: new Set([
    "job_type",
    "job_latency_bucket",
    "cache_hit",
    "result_size_bucket",
    "origin",
  ]),
  media_job_failed: new Set([
    "job_type",
    "stage",
    "safe_error_code",
    "retry_count_bucket",
    "origin",
  ]),
  tts_first_audio_ready: new Set(["sample_rate", "first_audio_latency_bucket", "origin"]),
  tts_playback_started: new Set(["source", "cache_hit", "origin"]),
  tts_playback_abandoned: new Set(["source", "listened_fraction_bucket", "origin"]),
  answer_feedback_submitted: new Set(["rating"]),
  app_version_seen: new Set(["version"]),
};

const ENUMS: Readonly<Record<string, ReadonlySet<SafeAnalyticsValue>>> = {
  book_kind: new Set(["builtin", "imported"]),
  channel: new Set(["production", "development", "staging"]),
  duration_bucket: new Set([
    "<1s",
    "1-4s",
    "5-14s",
    "15-59s",
    "<1m",
    "1-4m",
    "5-14m",
    "15m+",
    "5m+",
  ]),
  analysis_version: new Set(["v1"]),
  character_count_bucket: new Set(["0", "1-3", "4-8", "9+"]),
  pov: new Set(["first_person", "third_person", "unknown"]),
  confidence_bucket: new Set(["low", "medium", "high", "unknown"]),
  origin: new Set(["user", "background"]),
  stage: new Set([
    "import",
    "character_markup",
    "chapter_markup",
    "character_or_chapter_markup",
    "provider",
    "cache",
    "playback",
  ]),
  safe_error_code: new Set([
    "UNKNOWN",
    "VALIDATION",
    "NETWORK",
    "AUTH",
    "TIMEOUT",
    "RATE",
    "NO_KEY",
    "NO_PROXY",
    "PARSE",
    "CENSOR",
    "CANCELLED",
  ]),
  feature: new Set(["bookmark", "note", "character", "chat"]),
  job_type: new Set(["image", "tts", "avatar", "portrait_animation", "chapter_markup"]),
  provider: new Set(["kandinsky", "salutespeech", "video", "openrouter", "browser"]),
  model: new Set([
    "k6-image-t2i",
    "salutespeech-yourvoice",
    "k5-avatar",
    "k5-i2v-lite",
    "k5-i2v-hd",
    "deepseek-v4-flash",
    "unknown",
  ]),
  quality: new Set(["standard", "lite", "hd", "24000", "48000", "unknown"]),
  queue_depth_bucket: new Set(["0", "1-4", "5-9", "10+"]),
  queue_wait_bucket: new Set(["<1s", "1-4s", "5-14s", "15s+"]),
  job_latency_bucket: new Set(["<1s", "1-4s", "5-14s", "15-59s", "1-4m", "5m+"]),
  result_size_bucket: new Set(["<256kb", "256kb-1mb", "1-9mb", "10mb+"]),
  retry_count_bucket: new Set(["0", "1", "2+"]),
  source: new Set(["reader", "character", "chat", "scene"]),
  listened_fraction_bucket: new Set(["<10%", "10-49%", "50-89%", "90%+"]),
  rating: new Set(["helpful", "unhelpful"]),
  sample_rate: new Set([24000, 48000]),
  first_audio_latency_bucket: new Set(["<1s", "1-4s", "5-14s", "15s+"]),
};

function validValue(key: string, value: SafeAnalyticsValue): boolean {
  if (typeof value === "string" && (value.length > 120 || value.includes("\n"))) return false;
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || value < 0 || value > 1_000_000_000)
  ) {
    return false;
  }
  if (!["string", "number", "boolean"].includes(typeof value)) return false;
  if (ENUMS[key] && !ENUMS[key].has(value)) return false;
  if (
    ["version", "app_version"].includes(key) &&
    (typeof value !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(value))
  ) {
    return false;
  }
  return key !== "os_major" || (typeof value === "string" && /^\d{1,3}$/.test(value));
}

export function sanitizeAnalyticsProperties(
  name: AnalyticsEventName,
  properties: Record<string, SafeAnalyticsValue>,
): Record<string, SafeAnalyticsValue> {
  const allowed = EVENT_PROPERTIES[name];
  return Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => allowed.has(key) && validValue(key, value)),
  );
}

export function isEssentialAnalyticsEvent(name: AnalyticsEventName): boolean {
  return ESSENTIAL_ANALYTICS_EVENTS.has(name);
}

export function durationBucket(durationMs: number): string {
  if (durationMs < 1_000) return "<1s";
  if (durationMs < 5_000) return "1-4s";
  if (durationMs < 15_000) return "5-14s";
  if (durationMs < 60_000) return "15-59s";
  if (durationMs < 5 * 60_000) return "1-4m";
  if (durationMs < 15 * 60_000) return "5-14m";
  return "15m+";
}

export function characterCountBucket(count: number): string {
  if (count <= 0) return "0";
  if (count <= 3) return "1-3";
  if (count <= 8) return "4-8";
  return "9+";
}
