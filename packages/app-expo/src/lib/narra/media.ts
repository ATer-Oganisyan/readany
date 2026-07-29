import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import * as FileSystem from "expo-file-system/legacy";
import type { NarraCharacter } from "./types";

const MEDIA_DIR = `${FileSystem.documentDirectory}narra-media`;

async function ensureMediaDir() {
  const info = await FileSystem.getInfoAsync(MEDIA_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(MEDIA_DIR, { intermediates: true });
}

function safeKey(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 160);
}

// TODO(narra): Replace the long-lived synchronous image request with an async job flow:
// POST returns a jobId, the client polls its status, persists the pending job, and resumes it
// after navigation or an app restart. This avoids gateway/client timeouts during generation.
export async function generateCharacterPortrait(
  bookId: string,
  character: NarraCharacter,
): Promise<string> {
  const passport = character.passport;
  const prompt = [
    `Кинематографичный портрет персонажа ${character.fullName}.`,
    character.appearancePrompt,
    passport
      ? `${passport.age} лет, ${passport.build}, ${passport.hair}, ${passport.eyes}, ${passport.face}, ${passport.outfit}.`
      : "",
    `Выражение: ${character.expression || "естественное, в характере"}.`,
    "Один человек, по пояс, взгляд в камеру, мягкий драматический свет, без текста и рамок.",
  ]
    .filter(Boolean)
    .join(" ");
  const response = await narraGatewayRequest("/v2/media/images", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, width: 768, height: 1024 }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { image?: string; error?: string }
    | null;
  if (!response.ok || !payload?.image) {
    throw new Error(payload?.error || `Не удалось создать портрет (${response.status})`);
  }
  await ensureMediaDir();
  const path = `${MEDIA_DIR}/${safeKey(`${bookId}-${character.id}-portrait`)}.png`;
  await FileSystem.writeAsStringAsync(path, payload.image, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

export async function generateSceneImage(
  bookId: string,
  chapter: string,
  excerpt: string,
): Promise<string> {
  const response = await narraGatewayRequest("/v2/media/images", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: `Кинематографичная книжная иллюстрация к сцене из главы «${chapter}». ${excerpt.slice(
        0,
        3500,
      )}. Атмосферная композиция, герои и эпоха строго по тексту, без надписей, рамок и водяных знаков.`,
      width: 1024,
      height: 1024,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { image?: string; error?: string }
    | null;
  if (!response.ok || !payload?.image) {
    throw new Error(payload?.error || `Не удалось создать иллюстрацию (${response.status})`);
  }
  await ensureMediaDir();
  const path = `${MEDIA_DIR}/${safeKey(`${bookId}-${chapter}-${Date.now()}`)}.png`;
  await FileSystem.writeAsStringAsync(path, payload.image, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

export async function synthesizeNarraSpeech(text: string, voice: string): Promise<string> {
  const response = await narraGatewayRequest("/v2/speech/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 12_000), voice }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Не удалось озвучить текст (${response.status})`);
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
