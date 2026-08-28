import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import type { BackendSceneIntent, BackendSceneSnapshot } from "./backend-scene";

/** A signed URL is consumed immediately; it is never persisted in the store. */
export async function saveBackendSceneFile(
  intent: BackendSceneIntent,
  scene: BackendSceneSnapshot,
  signal?: AbortSignal,
  onMove?: (bytes: number, mime: string) => void,
): Promise<string> {
  if (!scene.imageUrl || !scene.mimeType) throw new Error("SCENE_ASSET_MISSING");
  const key = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([intent.bookEditionId, intent.markupIdentity, scene.sceneKey]),
  );
  const directory = new Directory(Paths.document, "narra-media");
  directory.create({ intermediates: true, idempotent: true });
  const extension =
    scene.mimeType === "image/png" ? "png" : scene.mimeType === "image/jpeg" ? "jpg" : "webp";
  const destination = new File(directory, `backend-scene-${key}.${extension}`);
  const temporary = new File(directory, `backend-scene-${key}-${Crypto.randomUUID()}.tmp`);
  const temporaryUri = temporary.uri;
  const download = new AbortController();
  const abort = () => download.abort();
  const timeout = setTimeout(abort, 60_000);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new Error("SCENE_ABORTED");
    await File.downloadFileAsync(scene.imageUrl, temporary, {
      idempotent: true,
      signal: download.signal,
    });
    if (signal?.aborted) throw new Error("SCENE_ABORTED");
    if (!temporary.exists || temporary.size <= 0) throw new Error("SCENE_EMPTY_DOWNLOAD");
    // Never remove a previous complete image before the replacement was verified.
    onMove?.(temporary.size, scene.mimeType);
    if (destination.exists) destination.delete();
    await temporary.move(destination);
    if (!destination.exists || destination.size <= 0) throw new Error("SCENE_FILE_NOT_SAVED");
    return destination.uri;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    // File.move changes the File instance URI. Clean only the original temporary path.
    const remainder = new File(temporaryUri);
    if (remainder.exists) remainder.delete();
  }
}
