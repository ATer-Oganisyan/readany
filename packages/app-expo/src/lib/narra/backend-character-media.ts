import { useLibraryStore } from "@/stores/library-store";
import { useNarraStore } from "@/stores/narra-store";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import type { BackendCharacterAsset } from "./backend-book-contract";
import { downloadVerifiedBackendFile } from "./backend-file-download";
import { sha256BackendFile } from "./backend-file-hash";
import { isCharacterUnlocked } from "./domain";

const root = `${FileSystem.documentDirectory}narra-backend-media`;
interface AssetRequest {
  promise: Promise<string>;
  controller: AbortController;
  consumers: number;
}
const active = new Map<string, AssetRequest>();
const verified = new Set<string>();

function consumeAsset(request: AssetRequest, signal?: AbortSignal): Promise<string> {
  request.consumers++;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error?: unknown, uri?: string) => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", abort);
      if (--request.consumers === 0) request.controller.abort();
      if (error) reject(error);
      else resolve(uri as string);
    };
    const abort = () => finish(new Error("Media consumer cancelled"));
    request.promise.then(
      (uri) => finish(undefined, uri),
      (error) => finish(error),
    );
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function materializeBackendCharacterAsset(
  edition: string,
  asset: BackendCharacterAsset,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new Error("Media consumer cancelled");
  const directory = `${root}/${encodeURIComponent(edition)}/${asset.type}`;
  const extension =
    asset.mimeType === "image/png"
      ? "png"
      : asset.mimeType === "image/webp"
        ? "webp"
        : asset.mimeType.startsWith("image/")
          ? "jpg"
          : asset.mimeType === "audio/wav" || asset.mimeType === "audio/x-wav"
            ? "wav"
            : asset.mimeType === "audio/mpeg"
              ? "mp3"
              : asset.mimeType.startsWith("audio/")
                ? "m4a"
                : "mp4";
  const destination = `${directory}/${asset.contentHash}.${extension}`;
  const existing = active.get(destination);
  if (existing && !existing.controller.signal.aborted) return consumeAsset(existing, signal);
  // Wait until a cancelled prior writer has removed its temporary file.
  if (existing) await existing.promise.catch(() => undefined);
  const controller = new AbortController();
  const task = (async () => {
    const info = await FileSystem.getInfoAsync(destination);
    if (
      info.exists &&
      !info.isDirectory &&
      info.size === asset.byteSize &&
      (verified.has(destination) ||
        (await sha256BackendFile(destination)).toLowerCase() === asset.contentHash)
    ) {
      verified.add(destination);
      return destination;
    }
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const temporary = `${destination}.${Crypto.randomUUID()}.tmp`;
    try {
      await downloadVerifiedBackendFile({
        destinationPath: temporary,
        downloadPath: asset.downloadPath,
        expectedSha256: asset.contentHash,
        expectedByteSize: asset.byteSize,
        label: "Character media",
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw new Error("Media cancelled");
      await FileSystem.moveAsync({ from: temporary, to: destination });
      verified.add(destination);
      return destination;
    } finally {
      await FileSystem.deleteAsync(temporary, { idempotent: true });
    }
  })();
  const request = { promise: task, controller, consumers: 0 };
  active.set(destination, request);
  const clear = () => {
    if (active.get(destination) === request) active.delete(destination);
  };
  void task.then(clear, clear);
  return consumeAsset(request, signal);
}

/** At most two characters across all active screens. Never start work for future characters. */
let characterWorkers = 0;
const waiters: (() => void)[] = [];
async function characterSlot<T>(work: () => Promise<T>) {
  if (characterWorkers >= 2) await new Promise<void>((resolve) => waiters.push(resolve));
  else characterWorkers++;
  try {
    return await work();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else characterWorkers--;
  }
}

export async function loadBackendCharacterMedia(
  bookId: string,
  progress: number,
  signal?: AbortSignal,
): Promise<void> {
  const state = useNarraStore.getState().books[bookId];
  if (!state?.backendBinding) return;
  const edition = state.backendBinding.bookEditionId;
  const characters = state.characters.filter(
    (item) => item.backendManaged && isCharacterUnlocked(progress, item),
  );
  // Each invocation queues only two workers, not every character in the book.
  let index = 0;
  await Promise.all(
    [0, 1].map(async () => {
      while (index < characters.length && !signal?.aborted) {
        const character = characters[index++];
        await characterSlot(async () => {
          const book = useLibraryStore.getState().books.find((item) => item.id === bookId);
          if (
            signal?.aborted ||
            !book ||
            book.deletedAt ||
            !isCharacterUnlocked(book.progress, character)
          )
            return;
          await Promise.allSettled(
            (character.backendAssets ?? []).map(async (asset) => {
              if (signal?.aborted) return;
              const uri = await materializeBackendCharacterAsset(edition, asset, signal);
              const latest = useNarraStore.getState().books[bookId];
              const current = latest?.characters.find((item) => item.id === character.id);
              if (
                signal?.aborted ||
                latest?.backendBinding?.bookEditionId !== edition ||
                !current?.backendAssets?.some(
                  (value) => value.type === asset.type && value.contentHash === asset.contentHash,
                )
              )
                return;
              if (
                current.backendMedia?.[asset.type]?.uri === uri &&
                current.backendMedia[asset.type]?.hash === asset.contentHash
              )
                return;
              useNarraStore.getState().updateCharacter(bookId, character.id, {
                backendMedia: {
                  ...current.backendMedia,
                  [asset.type]: { hash: asset.contentHash, uri },
                },
                ...(asset.type === "primary_portrait" && !current.portraitUriOverridesAsset
                  ? { portraitUri: uri }
                  : {}),
              });
            }),
          );
        });
      }
    }),
  );
}
