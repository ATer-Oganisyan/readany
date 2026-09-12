import * as FileSystem from "expo-file-system/legacy";
import { useNarraStore } from "@/stores/narra-store";
import type { NarraBookState } from "./types";

const folders = ["narra-media", "narra-backend-media", "narra-backend-sources"];
const recentDownloads = new Map<string, { consumers: number; expires: number }>();
let nextCleanup = 0;

export function scheduleUnusedBackendMediaCleanup() {
  if (!useNarraStore.getState()._hasHydrated || Date.now() < nextCleanup) return;
  nextCleanup = Date.now() + 24 * 60 * 60 * 1000;
  void clearUnusedBackendMedia().catch((error) =>
    console.warn("[media-cache] Cleanup failed:", error),
  );
}

export function protectBackendMedia(uri: string) {
  const now = Date.now();
  for (const [path, entry] of recentDownloads) {
    if (!entry.consumers && entry.expires < now) recentDownloads.delete(path);
  }
  const entry = recentDownloads.get(uri) ?? { consumers: 0, expires: 0 };
  entry.consumers++;
  recentDownloads.set(uri, entry);
  return () => {
    entry.consumers--;
    // Allow the caller to publish the downloaded URI into its book state.
    entry.expires = Date.now() + 60_000;
  };
}

function isProtected(uri: string) {
  const entry = recentDownloads.get(uri);
  return entry && (entry.consumers > 0 || entry.expires >= Date.now());
}

// Only files owned by Narra; never follow arbitrary persisted paths outside these folders.
function ownedUri(value?: string): string | undefined {
  if (!value) return;
  const relative = value.startsWith(FileSystem.documentDirectory!)
    ? value.slice(FileSystem.documentDirectory!.length)
    : value.includes("/Documents/")
      ? value.split("/Documents/").pop()!
      : value;
  if (!folders.some((folder) => relative.startsWith(`${folder}/`))) return;
  if (relative.split("/").some((part) => part === ".." || part === ".")) return;
  return `${FileSystem.documentDirectory}${relative}`;
}

export function bookMediaFiles(book: NarraBookState): Set<string> {
  const files = new Set<string>();
  const add = (value?: string) => {
    const uri = ownedUri(value);
    if (uri) files.add(uri);
  };
  add(book.backendOriginalSource?.path);
  for (const character of book.characters) {
    add(character.portraitUri);
    for (const media of Object.values(character.backendMedia ?? {})) add(media?.uri);
  }
  for (const scene of [
    ...Object.values(book.scenes),
    ...Object.values(book.scenesByBackendId ?? {}),
  ]) {
    add(scene.imageUri);
    add(scene.videoUri);
  }
  for (const audio of Object.values(book.sceneAudios)) {
    for (const segment of audio.segments) add(segment.audioUri);
  }
  return files;
}

function referenceCheck() {
  let previousBooks: Record<string, NarraBookState> | undefined;
  let files = new Set<string>();
  return (uri: string) => {
    const books = useNarraStore.getState().books;
    if (books !== previousBooks) {
      files = new Set(Object.values(books).flatMap((book) => [...bookMediaFiles(book)]));
      previousBooks = books;
    }
    return files.has(uri);
  };
}

/** Call after removing the state. Other editions/imports can share the same media file. */
export async function deleteRemovedBookMedia(book: NarraBookState): Promise<void> {
  const isReferenced = referenceCheck();
  for (const uri of bookMediaFiles(book)) {
    if (!isProtected(uri) && !isReferenced(uri)) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  }
}

export async function clearRemovedBookData(bookId: string): Promise<void> {
  if (!useNarraStore.getState()._hasHydrated) {
    await new Promise<void>((resolve) => {
      const unsubscribe = useNarraStore.subscribe((state) => {
        if (state._hasHydrated) {
          unsubscribe();
          resolve();
        }
      });
    });
  }
  const book = useNarraStore.getState().books[bookId];
  useNarraStore.getState().clearBook(bookId);
  if (book) await deleteRemovedBookMedia(book);
}

/** Remove obsolete server downloads only. Referenced offline media and user generations survive. */
export async function clearUnusedBackendMedia() {
  const result = { deletedFiles: 0, deletedBytes: 0 };
  if (!useNarraStore.getState()._hasHydrated) return result;
  const isReferenced = referenceCheck();
  const cutoff = Date.now() / 1000 - 24 * 60 * 60;
  async function visit(directory: string): Promise<void> {
    const info = await FileSystem.getInfoAsync(directory);
    if (!info.exists || !info.isDirectory) return;
    for (const name of await FileSystem.readDirectoryAsync(directory)) {
      const uri = `${directory}/${name}`;
      const file = await FileSystem.getInfoAsync(uri);
      if (!file.exists) continue;
      if (file.isDirectory) await visit(uri);
      // Recent files may still be in flight or awaiting publication into the store.
      else if (file.modificationTime < cutoff && !isProtected(uri) && !isReferenced(uri)) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        result.deletedFiles++;
        result.deletedBytes += file.size;
      }
    }
  }
  await visit(`${FileSystem.documentDirectory}narra-backend-media`);
  return result;
}
