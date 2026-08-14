import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import * as FileSystem from "expo-file-system/legacy";
import { generateOpenRouterImageWithFallback } from "../ai/openrouter-image";
import { resolveCoverGenreProfile } from "../book/cover-genre";
import { budgetPrompt } from "./art-style";
import { normalizeNarraError } from "./errors";
import { type NarraGenreAnalysis, narraGenreLabel } from "./genre-analysis";
import { buildCharacterPortraitPrompt } from "./portrait-prompt";
import { mentionedCharacters, passportDescription } from "./scene-prompt";
import { applyActiveStressMarkup } from "./stress-markup";
import type { NarraCharacter } from "./types";
import type { NarraProsody } from "./voice-rules";

const MEDIA_DIR = `${FileSystem.documentDirectory}narra-media`;
const MEDIA_PATH_MARKER = "/Documents/narra-media/";
let speechFileSequence = 0;
const portraitRequests = new Map<string, Promise<string>>();
const OPENROUTER_IMAGE_MODEL = "openai/gpt-image-2";
const OPENROUTER_IMAGE_FALLBACK_MODEL = "google/gemini-2.5-flash-image";

type MediaJobType = "image" | "cover" | "tts" | "avatar" | "video";
type MediaJobOrigin = "user" | "background";

const MEDIA_JOB_ROUTES: Record<MediaJobType, { provider: string; model: string }> = {
  image: { provider: "kandinsky", model: "k6-image-t2i" },
  cover: { provider: "openrouter", model: "gpt-image-2" },
  tts: { provider: "salutespeech", model: "salutespeech-yourvoice" },
  avatar: { provider: "openrouter", model: "gpt-image-2" },
  video: { provider: "openrouter", model: "veo-3.1-lite" },
};

function mediaLatencyBucket(durationMs: number): string {
  if (durationMs < 1_000) return "<1s";
  if (durationMs < 5_000) return "1-4s";
  if (durationMs < 15_000) return "5-14s";
  if (durationMs < 60_000) return "15-59s";
  if (durationMs < 5 * 60_000) return "1-4m";
  return "5m+";
}

function firstAudioLatencyBucket(durationMs: number): string {
  if (durationMs < 1_000) return "<1s";
  if (durationMs < 5_000) return "1-4s";
  if (durationMs < 15_000) return "5-14s";
  return "15s+";
}

/**
 * Единая телеметрия медиа-генераций. По умолчанию provider/model гейтвейные
 * (Kandinsky/SaluteSpeech); OpenRouter-путь сцен (scene-image-openrouter.ts)
 * передаёт свои через meta, сами события и поля не меняются.
 */
export async function trackNarraMediaJob<T>(
  jobType: MediaJobType,
  origin: MediaJobOrigin,
  operation: () => Promise<T>,
  meta?: { provider: string; model: string },
): Promise<T> {
  const startedAt = Date.now();
  const route = MEDIA_JOB_ROUTES[jobType];
  const provider = meta?.provider ?? route.provider;
  const model = meta?.model ?? route.model;
  recordTelemetry("media_job_enqueued", {
    job_type: jobType,
    provider,
    model,
    quality: "unknown",
    queue_depth_bucket: "0",
    origin,
  });
  recordTelemetry("media_job_started", {
    job_type: jobType,
    queue_wait_bucket: "<1s",
    origin,
  });
  try {
    const result = await operation();
    recordTelemetry("media_job_completed", {
      job_type: jobType,
      job_latency_bucket: mediaLatencyBucket(Date.now() - startedAt),
      cache_hit: false,
      origin,
    });
    return result;
  } catch (error) {
    const code = normalizeNarraError(error).code;
    const safeErrorCode = {
      AUTH: "AUTH",
      CONFIG: "NO_PROXY",
      CONNECTION: "NETWORK",
      RATE: "RATE",
      REQUEST: "VALIDATION",
      SERVICE: "UNKNOWN",
      TIMEOUT: "TIMEOUT",
    }[code];
    recordTelemetry("media_job_failed", {
      job_type: jobType,
      stage: "provider",
      safe_error_code: safeErrorCode,
      retry_count_bucket: "0",
      origin,
    });
    throw error;
  }
}

/** Rehomes persisted iOS file URIs after the app data-container UUID changes. */
export function normalizePersistedNarraMediaUri(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  const markerIndex = uri.indexOf(MEDIA_PATH_MARKER);
  if (markerIndex === -1) return uri;
  const filename = uri.slice(markerIndex + MEDIA_PATH_MARKER.length);
  return `${MEDIA_DIR}/${filename}`;
}

async function ensureMediaDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MEDIA_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(MEDIA_DIR, { intermediates: true });
}

function safeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 160);
}

interface PortraitBookContext {
  description: string;
  genreId: string;
  genreLabel: string;
}

interface PortraitGenreBookMeta {
  title: string;
  description?: string;
  subjects?: string[];
}

export function resolvePortraitGenre(
  meta: PortraitGenreBookMeta,
  analyzedGenre?: NarraGenreAnalysis,
): { id: string; label: string } {
  if (analyzedGenre) {
    return {
      id: analyzedGenre.primary,
      label: narraGenreLabel(analyzedGenre.primary),
    };
  }

  const explicitlyClassic = meta.subjects?.some((subject) => /(?:classic|классик)/iu.test(subject));
  return explicitlyClassic
    ? { id: "classic", label: "классическая литература" }
    : resolveCoverGenreProfile(meta);
}

/** Контекст книги и жанр для портретов персонажей. */
function portraitBookContext(bookId: string): PortraitBookContext | undefined {
  try {
    // Ленивый импорт, чтобы не тянуть стор в юнит-тесты чистых промптов
    const { useLibraryStore, useNarraStore } = require("@/stores") as typeof import("@/stores");
    const book = useLibraryStore.getState().books.find((item) => item.id === bookId);
    if (!book) return undefined;
    const analyzedGenre = useNarraStore.getState().books[bookId]?.genre;
    const author = book.meta.author ? ` (${book.meta.author})` : "";
    const genre = resolvePortraitGenre(book.meta, analyzedGenre);
    return {
      description: `«${book.meta.title}»${author}`,
      genreId: genre.id,
      genreLabel: genre.label,
    };
  } catch {
    return undefined;
  }
}

export function portraitPrompt(
  character: NarraCharacter,
  bookContext?: string,
  genreId = "classic",
  genreLabel = "классическая литература",
): string {
  return buildCharacterPortraitPrompt(character, { bookContext, genreId, genreLabel });
}

function imagePayload(payload: unknown): { base64?: string; url?: string; error?: string } {
  if (!payload || typeof payload !== "object") return {};
  const value = payload as {
    image?: string;
    b64_json?: string;
    url?: string;
    error?: string;
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const image = value.image;
  if (image?.startsWith("http://") || image?.startsWith("https://")) return { url: image };
  return {
    base64:
      image?.replace(/^data:image\/[^;]+;base64,/, "") ||
      value.b64_json ||
      value.data?.[0]?.b64_json,
    url: value.url || value.data?.[0]?.url,
    error: value.error,
  };
}

// passportDescription/mentionedCharacters переехали в scene-prompt.ts (P16) —
// единый источник для гейтвей- и OpenRouter-промптов.

const KANDINSKY_SAFETY_REJECTION =
  /политик[А-Яа-яЁё]* безопасности|safety|content policy|moderation/iu;

function neutralizeSensitiveSceneText(excerpt: string): string {
  const narration = excerpt
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("—"))
    .join(" ");
  const visualSource = narration.length >= 120 ? narration : excerpt;
  return visualSource
    .replace(/восстани[А-Яа-яЁё]*/giu, "собрание")
    .replace(/борьб[А-Яа-яЁё]*/giu, "настойчивые усилия")
    .replace(/перебьют/giu, "остановят")
    .replace(/командующ[А-Яа-яЁё]*/giu, "руководитель")
    .replace(/подпольн[А-Яа-яЁё]*/giu, "закрытого")
    .replace(/революц[А-Яа-яЁё]*/giu, "общественного")
    .replace(/политич[А-Яа-яЁё]*/giu, "общественного")
    .replace(/убий[А-Яа-яЁё]*/giu, "конфликт")
    .replace(/убил[А-Яа-яЁё]*/giu, "остановил")
    .replace(/оруж[А-Яа-яЁё]*/giu, "предметы")
    .replace(/выстрел[А-Яа-яЁё]*/giu, "резкие звуки")
    .replace(/кров[А-Яа-яЁё]*/giu, "следы")
    .replace(/террор[А-Яа-яЁё]*/giu, "опасность")
    .replace(/насили[А-Яа-яЁё]*/giu, "конфликт")
    .replace(/кулак/giu, "руку")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSceneImagePrompt(
  chapter: string,
  excerpt: string,
  characters: NarraCharacter[],
): string {
  const canon = mentionedCharacters(excerpt, characters)
    .map((character) => `${character.fullName}: ${passportDescription(character)}`)
    .join("; ");
  return budgetPrompt([
    `Иллюстрация сцены из главы «${chapter}».`,
    canon
      ? `В кадре только эти герои, внешность соблюдать точно: ${canon}. Одежда из сцены важнее паспортной.`
      : "",
    `Сцена: ${excerpt}`,
    "Широкая общая композиция в едином пространстве, НЕ коллаж. Не добавляй отсутствующих героев.",
  ]);
}

export function buildSafetyFallbackSceneImagePrompt(
  excerpt: string,
  characters: NarraCharacter[],
): string {
  const canon = mentionedCharacters(excerpt, characters)
    .map((character) => `${character.fullName}: ${passportDescription(character)}`)
    .join("; ");
  return budgetPrompt([
    "Нейтральная книжная иллюстрация спокойного момента.",
    canon ? `В кадре только эти герои, внешность соблюдать точно: ${canon}.` : "",
    `Сцена: ${neutralizeSensitiveSceneText(excerpt)}`,
    "Покажи окружение, свет и одежду персонажей. Без символики. Не добавляй отсутствующих героев и лишних людей.",
  ]);
}

function isKandinskySafetyRejection(error?: string): boolean {
  return !!error && KANDINSKY_SAFETY_REJECTION.test(error);
}

async function requestSceneImage(prompt: string): Promise<{
  response: Response;
  payload: { base64?: string; url?: string; error?: string };
}> {
  const response = await narraGatewayRequest("/v2/media/images", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      width: 1024,
      height: 1024,
      engine: "kandinsky",
    }),
  });
  return {
    response,
    payload: imagePayload(await response.json().catch(() => null)),
  };
}

async function persistGeneratedImage(
  path: string,
  payload: { base64?: string; url?: string },
): Promise<string> {
  const temporaryPath = `${path}.${Date.now()}.tmp`;
  if (payload.base64) {
    await FileSystem.writeAsStringAsync(temporaryPath, payload.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } else if (payload.url) {
    await FileSystem.downloadAsync(payload.url, temporaryPath);
  } else {
    throw new Error("Image response is empty");
  }
  await FileSystem.deleteAsync(path, { idempotent: true });
  await FileSystem.moveAsync({ from: temporaryPath, to: path });
  return path;
}

/**
 * Абсолютный file://-путь нового файла в narra-media (каталог создаётся при
 * необходимости). Используется видео-оживлением (animate-openrouter.ts):
 * downloadAsync пишет напрямую в целевой путь, единое именование с картинками.
 */
export async function narraMediaTargetPath(key: string, extension: string): Promise<string> {
  await ensureMediaDir();
  return `${MEDIA_DIR}/${safeKey(key)}.${extension}`;
}

/**
 * Сохраняет base64-картинку сцены в narra-media и возвращает file://-путь.
 * Используется OpenRouter-путём (scene-image-openrouter.ts); именование файла
 * то же, что у гейтвей-сцен, чтобы restore/normalize работали одинаково.
 */
export async function persistSceneImageBase64(
  bookId: string,
  base64: string,
  extension: "png" | "jpg" = "jpg",
): Promise<string> {
  await ensureMediaDir();
  const path = `${MEDIA_DIR}/${safeKey(`${bookId}-scene-${Date.now()}`)}.${extension}`;
  return persistGeneratedImage(path, { base64 });
}

async function generateCharacterPortraitRequest(
  bookId: string,
  character: NarraCharacter,
): Promise<string> {
  const book = portraitBookContext(bookId);
  const generated = await generateOpenRouterImageWithFallback(
    {
      model: OPENROUTER_IMAGE_MODEL,
      prompt: portraitPrompt(character, book?.description, book?.genreId, book?.genreLabel),
      aspectRatio: "3:4",
      quality: "high",
      outputFormat: "jpeg",
      outputCompression: 88,
    },
    OPENROUTER_IMAGE_FALLBACK_MODEL,
  );
  await ensureMediaDir();
  const path = `${MEDIA_DIR}/${safeKey(`${bookId}-${character.id}-portrait`)}.jpg`;
  return persistGeneratedImage(path, { base64: generated.base64 });
}

export function generateCharacterPortrait(
  bookId: string,
  character: NarraCharacter,
): Promise<string> {
  return trackNarraMediaJob("avatar", "background", () =>
    generateCharacterPortraitRequest(bookId, character),
  );
}

/** Shares portrait work between background catalog preloading and the chat screen. */
export function ensureCharacterPortrait(
  bookId: string,
  character: NarraCharacter,
): Promise<string> {
  if (character.portraitUri) {
    return Promise.resolve(normalizePersistedNarraMediaUri(character.portraitUri));
  }

  const key = `${bookId}:${character.id}`;
  const inFlight = portraitRequests.get(key);
  if (inFlight) return inFlight;

  const request = generateCharacterPortrait(bookId, character).finally(() => {
    portraitRequests.delete(key);
  });
  portraitRequests.set(key, request);
  return request;
}

async function generateSceneImageRequest(
  bookId: string,
  chapter: string,
  excerpt: string,
  characters: NarraCharacter[],
): Promise<string> {
  let { response, payload } = await requestSceneImage(
    buildSceneImagePrompt(chapter, excerpt, characters),
  );
  if (!response.ok && isKandinskySafetyRejection(payload.error)) {
    ({ response, payload } = await requestSceneImage(
      buildSafetyFallbackSceneImagePrompt(excerpt, characters),
    ));
  }
  if (!response.ok || (!payload.base64 && !payload.url)) {
    throw new Error(payload.error || `Scene generation failed (${response.status})`);
  }
  await ensureMediaDir();
  const path = `${MEDIA_DIR}/${safeKey(`${bookId}-scene-${Date.now()}`)}.png`;
  return persistGeneratedImage(path, payload);
}

export function generateSceneImage(
  bookId: string,
  chapter: string,
  excerpt: string,
  characters: NarraCharacter[],
): Promise<string> {
  return trackNarraMediaJob("image", "user", () =>
    generateSceneImageRequest(bookId, chapter, excerpt, characters),
  );
}

export interface GeneratedCoverImage {
  base64: string;
  mimeType: string;
  jobId: string;
}

async function generateBookCoverImageRequest(
  prompt: string,
  options: {
    requestId: string;
  },
): Promise<GeneratedCoverImage> {
  const generated = await generateOpenRouterImageWithFallback(
    {
      model: OPENROUTER_IMAGE_MODEL,
      prompt,
      aspectRatio: "2:3",
      quality: "high",
      outputFormat: "jpeg",
      outputCompression: 90,
    },
    OPENROUTER_IMAGE_FALLBACK_MODEL,
  );
  return {
    base64: generated.base64,
    mimeType: generated.mimeType,
    jobId: options.requestId,
  };
}

/** Personal dev mode: OpenRouter runs directly in the mobile app. */
export function generateBookCoverImage(
  prompt: string,
  options: {
    requestId: string;
  },
): Promise<GeneratedCoverImage> {
  return trackNarraMediaJob("cover", "background", () =>
    generateBookCoverImageRequest(prompt, options),
  );
}

export interface NarraSpeechOptions {
  /** Просодия голоса персонажа из voice-rules (pitch — полутоны, rate — множитель). */
  prosody?: NarraProsody;
  /** Пользовательская скорость воспроизведения (0.5–2, дефолт 1). */
  rate?: number;
}

function escapeSsmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * SSML для /v2/speech/synthesize (SaluteSpeech поддерживает <prosody rate pitch>,
 * см. синтез в narra). Скорость пользователя и просодия персонажа перемножаются;
 * pitch в полутонах переводится в проценты (~4% на полутон). Без отклонений от
 * дефолта возвращается null — синтез идёт обычным текстом.
 */
export function buildNarraSpeechSsml(
  text: string,
  prosody?: NarraProsody,
  rate?: number,
): string | null {
  const ratePercent = clamp(Math.round((rate ?? 1) * (prosody?.rate ?? 1) * 100), 50, 200);
  const pitchPercent = clamp(Math.round((prosody?.pitch ?? 0) * 4), -40, 40);
  if (ratePercent === 100 && pitchPercent === 0) return null;
  const pitch = `${pitchPercent >= 0 ? "+" : ""}${pitchPercent}%`;
  return `<speak><prosody rate="${ratePercent}%" pitch="${pitch}">${escapeSsmlText(text)}</prosody></speak>`;
}

async function synthesizeNarraSpeechRequest(
  text: string,
  voice: string,
  options?: NarraSpeechOptions,
): Promise<string> {
  const startedAt = Date.now();
  // Ударения (P9) размечаются здесь — в единой точке всей озвучки (книга,
  // сцены, чат) — до сборки SSML, чтобы работать и в {text}, и в {ssml}.
  const trimmed = applyActiveStressMarkup(text.slice(0, 12_000));
  const ssml = buildNarraSpeechSsml(trimmed, options?.prosody, options?.rate);
  const response = await narraGatewayRequest("/v2/speech/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ssml ? { ssml, voice } : { text: trimmed, voice }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Speech synthesis failed (${response.status})`);
  }
  const sampleRate = Number(response.headers.get("x-audio-sample-rate"));
  if (sampleRate === 24_000 || sampleRate === 48_000) {
    recordTelemetry("tts_first_audio_ready", {
      sample_rate: sampleRate,
      first_audio_latency_bucket: firstAudioLatencyBucket(Date.now() - startedAt),
      origin: "user",
    });
  }
  await ensureMediaDir();
  const path = `${MEDIA_DIR}/speech-${Date.now()}-${speechFileSequence++}.wav`;
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  await FileSystem.writeAsStringAsync(path, btoa(binary), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

export function synthesizeNarraSpeech(
  text: string,
  voice: string,
  options?: NarraSpeechOptions,
): Promise<string> {
  return trackNarraMediaJob("tts", "user", () =>
    synthesizeNarraSpeechRequest(text, voice, options),
  );
}
