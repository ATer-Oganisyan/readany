import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import * as FileSystem from "expo-file-system/legacy";
import { normalizeNarraError } from "./errors";
import type { NarraCharacter } from "./types";

const MEDIA_DIR = `${FileSystem.documentDirectory}narra-media`;
const MEDIA_PATH_MARKER = "/Documents/narra-media/";
let speechFileSequence = 0;
const portraitRequests = new Map<string, Promise<string>>();

type MediaJobType = "image" | "tts" | "avatar";
type MediaJobOrigin = "user" | "background";

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

async function trackMediaJob<T>(
  jobType: MediaJobType,
  origin: MediaJobOrigin,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const provider = jobType === "tts" ? "salutespeech" : "kandinsky";
  const model = jobType === "tts" ? "salutespeech-yourvoice" : "k6-image-t2i";
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

function portraitPrompt(character: NarraCharacter): string {
  const passport = character.passport;
  return [
    `Кинематографичный статичный портрет персонажа ${character.fullName}.`,
    character.appearancePrompt,
    passport
      ? `${passport.age} лет, ${passport.build}, ${passport.hair}, ${passport.eyes}, ${passport.face}, ${passport.outfit}.`
      : "",
    `Выражение: ${character.expression || "естественное, в характере"}.`,
    "Один человек, по пояс, взгляд в камеру, мягкий драматический свет, без текста, рамок и анимации.",
  ]
    .filter(Boolean)
    .join(" ");
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

function passportDescription(character: NarraCharacter): string {
  const passport = character.passport;
  if (!passport) return character.appearancePrompt;
  return [
    character.appearancePrompt,
    `${passport.age} лет`,
    passport.build,
    passport.hair,
    passport.eyes,
    passport.face,
    passport.outfit,
  ]
    .filter(Boolean)
    .join(", ");
}

function mentionedCharacters(excerpt: string, characters: NarraCharacter[]): NarraCharacter[] {
  const normalizedExcerpt = excerpt.toLocaleLowerCase("ru");
  return characters.filter((character) =>
    [character.name, character.fullName]
      .filter((name) => name.trim().length > 1)
      .some((name) => normalizedExcerpt.includes(name.toLocaleLowerCase("ru"))),
  );
}

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
    .join("\n");
  return [
    `Кинематографичная книжная иллюстрация к сцене из главы «${chapter}».`,
    excerpt.slice(0, 3500),
    canon ? `Канон внешности участвующих персонажей:\n${canon}` : "",
    "Строго следуй тексту и канону персонажей. Не добавляй отсутствующих героев.",
    "Атмосферная композиция, эпоха и одежда по книге, без надписей, рамок и водяных знаков.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildSafetyFallbackSceneImagePrompt(
  excerpt: string,
  characters: NarraCharacter[],
): string {
  const canon = mentionedCharacters(excerpt, characters)
    .map((character) => `${character.fullName}: ${passportDescription(character)}`)
    .join("\n");
  return [
    "Нейтральная кинематографичная книжная иллюстрация.",
    neutralizeSensitiveSceneText(excerpt).slice(0, 2200),
    canon ? `Внешность персонажей:\n${canon}` : "",
    "Покажи спокойный момент, окружение, свет и одежду персонажей. Без надписей и символики.",
  ]
    .filter(Boolean)
    .join("\n\n");
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

async function generateCharacterPortraitRequest(
  bookId: string,
  character: NarraCharacter,
): Promise<string> {
  const response = await narraGatewayRequest("/v2/media/images", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: portraitPrompt(character), width: 768, height: 1024 }),
  });
  const payload = imagePayload(await response.json().catch(() => null));
  if (!response.ok || (!payload.base64 && !payload.url)) {
    throw new Error(payload.error || `Portrait generation failed (${response.status})`);
  }
  await ensureMediaDir();
  const path = `${MEDIA_DIR}/${safeKey(`${bookId}-${character.id}-portrait`)}.png`;
  return persistGeneratedImage(path, payload);
}

export function generateCharacterPortrait(
  bookId: string,
  character: NarraCharacter,
): Promise<string> {
  return trackMediaJob("avatar", "background", () =>
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
  return trackMediaJob("image", "user", () =>
    generateSceneImageRequest(bookId, chapter, excerpt, characters),
  );
}

async function synthesizeNarraSpeechRequest(text: string, voice: string): Promise<string> {
  const startedAt = Date.now();
  const response = await narraGatewayRequest("/v2/speech/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 12_000), voice }),
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

export function synthesizeNarraSpeech(text: string, voice: string): Promise<string> {
  return trackMediaJob("tts", "user", () => synthesizeNarraSpeechRequest(text, voice));
}
