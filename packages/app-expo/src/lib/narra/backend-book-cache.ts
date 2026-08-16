import * as FileSystem from "expo-file-system/legacy";
import { type BackendBookManifest, requestBackendDownloadUrl } from "./backend-book-api";
import { sha256BackendFile } from "./backend-file-hash";
import { normalizeCharacterAnalysisResponse } from "./character-normalization";
import type { NarraCharacter } from "./types";

const CACHE_ROOT = `${FileSystem.documentDirectory}narra-backend-books`;
const CACHE_PATH_MARKER = "/Documents/narra-backend-books/";
const MEDIA_CHARACTER_CONCURRENCY = 2;

interface CachedBackendBook {
  manifest: BackendBookManifest;
  characters: NarraCharacter[];
}

function safeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 160);
}

function normalizedCacheUri(value: string | undefined): string | undefined {
  if (!value?.startsWith("file://")) return value;
  const markerIndex = value.indexOf(CACHE_PATH_MARKER);
  if (markerIndex === -1) return value;
  return `${CACHE_ROOT}/${value.slice(markerIndex + CACHE_PATH_MARKER.length)}`;
}

function extension(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "mp4";
  return "bin";
}

function backendUnlockProgress(
  character: BackendBookManifest["characters"][number],
  textLength: number | undefined,
): number {
  const normalizedTextLength = Number(textLength);
  const firstAppearanceTextOffset = Number(character.firstAppearanceTextOffset);
  if (
    Number.isFinite(normalizedTextLength) &&
    normalizedTextLength > 0 &&
    Number.isFinite(firstAppearanceTextOffset)
  ) {
    return Math.min(0.95, Math.max(0, firstAppearanceTextOffset / normalizedTextLength));
  }
  const profileThreshold = Number(
    character.profile.unlockFraction ?? character.profile.unlockProgress,
  );
  return Number.isFinite(profileThreshold) ? Math.min(0.95, Math.max(0, profileThreshold)) : 0;
}

async function ensureBookDirectory(bookId: string): Promise<string> {
  const directory = `${CACHE_ROOT}/${safeKey(bookId)}`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return directory;
}

async function downloadedAsset(
  directory: string,
  asset: NonNullable<BackendBookManifest["characters"][number]["bundle"]>["assets"][number],
): Promise<string> {
  const filename = `${safeKey(asset.type)}-${asset.contentHash}.${extension(asset.mimeType)}`;
  const path = `${directory}/${filename}`;
  const existing = await FileSystem.getInfoAsync(path);
  if (
    existing.exists &&
    !existing.isDirectory &&
    existing.size === asset.byteSize &&
    (await sha256BackendFile(path)) === asset.contentHash
  ) {
    return path;
  }
  if (existing.exists) await FileSystem.deleteAsync(path, { idempotent: true });

  const url = await requestBackendDownloadUrl(asset.downloadPath);
  const temporary = `${path}.${Date.now()}.tmp`;
  const task = FileSystem.createDownloadResumable(url, temporary, {
    sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
  });
  const result = await task.downloadAsync();
  if (!result) throw new Error("Backend media download was cancelled");
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(temporary, { idempotent: true });
    throw new Error(`Backend media download failed (${result.status})`);
  }
  const info = await FileSystem.getInfoAsync(temporary);
  if (!info.exists || info.isDirectory || info.size !== asset.byteSize) {
    await FileSystem.deleteAsync(temporary, { idempotent: true });
    throw new Error("Backend media size mismatch");
  }
  if ((await sha256BackendFile(temporary)) !== asset.contentHash) {
    await FileSystem.deleteAsync(temporary, { idempotent: true });
    throw new Error("Backend media checksum mismatch");
  }
  await FileSystem.deleteAsync(path, { idempotent: true });
  await FileSystem.moveAsync({ from: temporary, to: path });
  return path;
}

function baseCharacter(
  character: BackendBookManifest["characters"][number],
  source: BackendBookManifest["source"],
  textLength: BackendBookManifest["textLength"],
): NarraCharacter {
  const unlockProgress = backendUnlockProgress(character, textLength);
  const clientCharacterId =
    typeof character.profile.clientCharacterId === "string" &&
    character.profile.clientCharacterId.trim()
      ? character.profile.clientCharacterId
      : character.characterKey;
  const normalized = normalizeCharacterAnalysisResponse({
    characters: [
      {
        ...character.profile,
        id: clientCharacterId,
        name: character.name,
        fullName: character.fullName,
        unlockProgress,
      },
    ],
  })[0];
  return {
    ...(normalized ?? {
      id: character.characterKey,
      name: character.name,
      fullName: character.fullName,
      role: "Персонаж истории",
      gender: "male" as const,
      voice: "She",
      traits: [],
      speechStyle: "",
      speechExamples: [],
      appearancePrompt: "",
      unlockProgress,
    }),
    id: clientCharacterId,
    name: character.name,
    fullName: character.fullName,
    unlockProgress,
    mediaSource: "backend",
    mediaState: character.state,
    analysisSource: source,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function projectBackendManifestCharacters(manifest: BackendBookManifest): NarraCharacter[] {
  return manifest.characters.map((character) => ({
    ...baseCharacter(character, manifest.source, manifest.textLength),
    // Server readiness means the bundle exists remotely. The local client only
    // marks it ready after all three files have passed integrity checks.
    mediaState: "preparing" as const,
  }));
}

export async function persistBackendManifestCharacters(
  bookId: string,
  manifest: BackendBookManifest,
  characters: NarraCharacter[],
): Promise<void> {
  const directory = await ensureBookDirectory(bookId);
  const cache: CachedBackendBook = { manifest, characters };
  await FileSystem.writeAsStringAsync(`${directory}/manifest.json`, JSON.stringify(cache));
}

export async function materializeBackendManifest(
  bookId: string,
  manifest: BackendBookManifest,
  onCharacter?: (character: NarraCharacter) => void,
): Promise<NarraCharacter[]> {
  const directory = await ensureBookDirectory(bookId);
  return mapWithConcurrency(manifest.characters, MEDIA_CHARACTER_CONCURRENCY, async (character) => {
    const result = baseCharacter(character, manifest.source, manifest.textLength);
    let materialized = result;
    if (character.state !== "ready" || !character.bundle) {
      onCharacter?.(materialized);
      return materialized;
    }
    try {
      const requiredTypes = new Set(character.bundle.assets.map((asset) => asset.type));
      if (
        !["primary_portrait", "greeting_audio", "idle_animation"].every((type) =>
          requiredTypes.has(type as "primary_portrait" | "greeting_audio" | "idle_animation"),
        )
      ) {
        throw new Error("Backend character bundle is incomplete");
      }
      const paths = await Promise.all(
        character.bundle.assets.map(async (asset) => ({
          type: asset.type,
          path: await downloadedAsset(directory, asset),
        })),
      );
      const byType = new Map(paths.map(({ type, path }) => [type, path]));
      materialized = {
        ...result,
        portraitUri: byType.get("primary_portrait"),
        greetingAudioUri: byType.get("greeting_audio"),
        idleAnimationUri: byType.get("idle_animation"),
        mediaState: "ready" as const,
      };
    } catch (error) {
      console.warn("[NarraBackend] Atomic media cache failed", {
        bookId,
        characterId: character.characterKey,
        error: error instanceof Error ? error.message : String(error),
      });
      materialized = { ...result, mediaState: "preparing" as const };
    }
    onCharacter?.(materialized);
    return materialized;
  });
}

export async function loadCachedBackendCharacters(bookId: string): Promise<NarraCharacter[]> {
  try {
    const directory = await ensureBookDirectory(bookId);
    const value = JSON.parse(
      await FileSystem.readAsStringAsync(`${directory}/manifest.json`),
    ) as CachedBackendBook;
    if (!Array.isArray(value.characters)) return [];
    return value.characters.map((character) => ({
      ...character,
      portraitUri: normalizedCacheUri(character.portraitUri),
      greetingAudioUri: normalizedCacheUri(character.greetingAudioUri),
      idleAnimationUri: normalizedCacheUri(character.idleAnimationUri),
    }));
  } catch {
    return [];
  }
}
