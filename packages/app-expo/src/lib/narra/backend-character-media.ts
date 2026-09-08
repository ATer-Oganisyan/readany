import { useLibraryStore } from "@/stores/library-store";
import { useNarraStore } from "@/stores/narra-store";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import type { BackendCharacterAsset } from "./backend-book-contract";
import { downloadVerifiedBackendFile } from "./backend-file-download";
import { sha256BackendFile } from "./backend-file-hash";
import { isCharacterUnlocked } from "./domain";
import type { NarraCharacter } from "./types";

const root = `${FileSystem.documentDirectory}narra-backend-media`;
interface AssetRequest {
  promise: Promise<string>;
  controller: AbortController;
  consumers: number;
}
const active = new Map<string, AssetRequest>();
const verified = new Set<string>();

function mediaCancellationError(): Error {
  const error = new Error("Media consumer cancelled");
  error.name = "AbortError";
  return error;
}

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
    const abort = () => finish(mediaCancellationError());
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
  if (signal?.aborted) throw mediaCancellationError();
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

interface CharacterAssetJob {
  characterId: string;
  asset: BackendCharacterAsset;
  requiresUnlock: boolean;
}

export interface BackendCharacterMediaPlan {
  unlockedPortraits: CharacterAssetJob[];
  nextPortrait: CharacterAssetJob[];
  unlockedRemainder: CharacterAssetJob[];
}

/**
 * Portraits are user-visible immediately, so they go before audio/video. We also
 * warm exactly one upcoming portrait without exposing the character itself.
 */
export function planBackendCharacterMedia(
  characters: readonly NarraCharacter[],
  progress: number,
): BackendCharacterMediaPlan {
  const backendCharacters = characters.filter((character) => character.backendManaged);
  const unlocked = backendCharacters.filter((character) =>
    isCharacterUnlocked(progress, character),
  );
  const futureWithPortrait = backendCharacters
    .filter((character) => !isCharacterUnlocked(progress, character))
    .sort((a, b) => a.unlockProgress - b.unlockProgress)
    .find((character) =>
      character.backendAssets?.some((asset) => asset.type === "primary_portrait"),
    );
  const jobs = (
    values: readonly NarraCharacter[],
    predicate: (asset: BackendCharacterAsset) => boolean,
    requiresUnlock: boolean,
  ): CharacterAssetJob[] =>
    values.flatMap((character) =>
      (character.backendAssets ?? [])
        .filter(predicate)
        .map((asset) => ({ characterId: character.id, asset, requiresUnlock })),
    );

  return {
    unlockedPortraits: jobs(unlocked, (asset) => asset.type === "primary_portrait", true),
    nextPortrait: futureWithPortrait
      ? jobs([futureWithPortrait], (asset) => asset.type === "primary_portrait", false)
      : [],
    unlockedRemainder: jobs(unlocked, (asset) => asset.type !== "primary_portrait", true),
  };
}

async function loadCharacterAssetJobs(
  bookId: string,
  edition: string,
  jobs: readonly CharacterAssetJob[],
  signal?: AbortSignal,
): Promise<void> {
  let index = 0;
  await Promise.all(
    [0, 1].map(async () => {
      while (index < jobs.length && !signal?.aborted) {
        const job = jobs[index++];
        try {
          await characterSlot(async () => {
            const book = useLibraryStore.getState().books.find((item) => item.id === bookId);
            const character = useNarraStore
              .getState()
              .books[bookId]?.characters.find((item) => item.id === job.characterId);
            if (
              signal?.aborted ||
              !book ||
              book.deletedAt ||
              !character ||
              (job.requiresUnlock && !isCharacterUnlocked(book.progress, character))
            )
              return;

            const uri = await materializeBackendCharacterAsset(edition, job.asset, signal);
            const latest = useNarraStore.getState().books[bookId];
            const current = latest?.characters.find((item) => item.id === job.characterId);
            if (
              signal?.aborted ||
              latest?.backendBinding?.bookEditionId !== edition ||
              !current?.backendAssets?.some(
                (value) =>
                  value.type === job.asset.type && value.contentHash === job.asset.contentHash,
              )
            )
              return;
            if (
              current.backendMedia?.[job.asset.type]?.uri === uri &&
              current.backendMedia[job.asset.type]?.hash === job.asset.contentHash
            )
              return;
            useNarraStore.getState().updateCharacter(bookId, job.characterId, {
              backendMedia: {
                ...current.backendMedia,
                [job.asset.type]: { hash: job.asset.contentHash, uri },
              },
              ...(job.asset.type === "primary_portrait" && !current.portraitUriOverridesAsset
                ? { portraitUri: uri }
                : {}),
            });
          });
        } catch {
          // A screen may release its consumer while another keeps the shared download alive.
          // Individual media failures are retried by the next manifest/progress refresh.
        }
      }
    }),
  );
}

export async function loadBackendCharacterMedia(
  bookId: string,
  progress: number,
  signal?: AbortSignal,
): Promise<void> {
  const state = useNarraStore.getState().books[bookId];
  if (!state?.backendBinding) return;
  const edition = state.backendBinding.bookEditionId;
  const plan = planBackendCharacterMedia(state.characters, progress);
  // Strict phases keep visible portraits ahead of speculative and decorative media.
  await loadCharacterAssetJobs(bookId, edition, plan.unlockedPortraits, signal);
  await loadCharacterAssetJobs(bookId, edition, plan.nextPortrait, signal);
  await loadCharacterAssetJobs(bookId, edition, plan.unlockedRemainder, signal);
}
