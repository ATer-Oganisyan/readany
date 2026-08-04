import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import * as FileSystem from "expo-file-system/legacy";
import type { NarraCharacter } from "./types";

const MEDIA_DIR = `${FileSystem.documentDirectory}narra-media`;
const MEDIA_PATH_MARKER = "/Documents/narra-media/";

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

export async function generateCharacterPortrait(
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

export async function generateSceneImage(
  bookId: string,
  chapter: string,
  excerpt: string,
  characters: NarraCharacter[],
): Promise<string> {
  const response = await narraGatewayRequest("/v2/media/images", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: buildSceneImagePrompt(chapter, excerpt, characters),
      width: 1024,
      height: 1024,
      engine: "kandinsky",
    }),
  });
  const payload = imagePayload(await response.json().catch(() => null));
  if (!response.ok || (!payload.base64 && !payload.url)) {
    throw new Error(payload.error || `Scene generation failed (${response.status})`);
  }
  await ensureMediaDir();
  const path = `${MEDIA_DIR}/${safeKey(`${bookId}-scene-${Date.now()}`)}.png`;
  return persistGeneratedImage(path, payload);
}

export async function synthesizeNarraSpeech(text: string, voice: string): Promise<string> {
  const response = await narraGatewayRequest("/v2/speech/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 12_000), voice }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Speech synthesis failed (${response.status})`);
  }
  await ensureMediaDir();
  const path = `${MEDIA_DIR}/speech-${Date.now()}.wav`;
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
