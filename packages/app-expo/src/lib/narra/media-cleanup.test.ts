import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NarraBookState } from "./types";

const runtime = vi.hoisted(() => ({
  books: {} as Record<string, NarraBookState>,
  hydrated: true,
  subscribe: vi.fn(),
  clearBook: vi.fn(),
  files: new Map<string, { isDirectory: boolean; size: number; modificationTime: number }>(),
  remove: vi.fn(async (_uri: string, _options: unknown) => {}),
}));
vi.mock("@/stores/narra-store", () => ({
  useNarraStore: {
    getState: () => ({
      books: runtime.books,
      _hasHydrated: runtime.hydrated,
      clearBook: runtime.clearBook,
    }),
    subscribe: runtime.subscribe,
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  deleteAsync: runtime.remove,
  getInfoAsync: async (uri: string) => ({
    exists: runtime.files.has(uri),
    ...runtime.files.get(uri),
  }),
  readDirectoryAsync: async (uri: string) =>
    [...runtime.files.keys()]
      .filter((path) => path.startsWith(`${uri}/`) && !path.slice(uri.length + 1).includes("/"))
      .map((path) => path.slice(uri.length + 1)),
}));
import {
  bookMediaFiles,
  clearUnusedBackendMedia,
  clearRemovedBookData,
  deleteRemovedBookMedia,
  protectBackendMedia,
} from "./media-cleanup";
import { emptyNarraBookState } from "./domain";

const root = "file:///documents/narra-backend-media";
function bookWithImage(uri: string) {
  const book = emptyNarraBookState("book");
  book.scenes.one = { imageUri: uri, sourceKey: "one", excerpt: "", chapter: "", generatedAt: 0 };
  return book;
}
beforeEach(() => {
  vi.clearAllMocks();
  runtime.books = {};
  runtime.clearBook.mockImplementation((id: string) => {
    delete runtime.books[id];
  });
  runtime.hydrated = true;
  runtime.files.clear();
  runtime.files.set(root, { isDirectory: true, size: 0, modificationTime: 0 });
});
afterEach(() => vi.useRealTimers());
describe("safe media cleanup", () => {
  it("protects slow downloads until every consumer releases, then allows cleanup after publication grace", async () => {
    vi.useFakeTimers();
    const uri = `${root}/slow.png`;
    const first = protectBackendMedia(uri);
    const second = protectBackendMedia(uri);
    first();
    vi.advanceTimersByTime(120_000);
    await deleteRemovedBookMedia(bookWithImage(uri));
    expect(runtime.remove).not.toHaveBeenCalled();
    second();
    await deleteRemovedBookMedia(bookWithImage(uri));
    expect(runtime.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_001);
    await deleteRemovedBookMedia(bookWithImage(uri));
    expect(runtime.remove).toHaveBeenCalledWith(uri, { idempotent: true });
  });
  it("waits for persisted books before deleting and keeps the other hydrated book's shared media", async () => {
    runtime.hydrated = false;
    let notify!: (state: { _hasHydrated: boolean }) => void;
    const unsubscribe = vi.fn();
    runtime.subscribe.mockImplementation((listener) => {
      notify = listener;
      return unsubscribe;
    });
    const deletion = clearRemovedBookData("removed");
    expect(runtime.clearBook).not.toHaveBeenCalled();
    runtime.books = {
      removed: bookWithImage(`${root}/shared.png`),
      retained: bookWithImage(`${root}/shared.png`),
    };
    runtime.hydrated = true;
    notify({ _hasHydrated: true });
    await deletion;
    expect(runtime.clearBook).toHaveBeenCalledWith("removed");
    expect(runtime.books.removed).toBeUndefined();
    expect(runtime.books.retained).toBeDefined();
    expect(runtime.remove).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("defers deleting media another consumer is acquiring before its reference is published", async () => {
    const uri = `${root}/acquiring.png`;
    protectBackendMedia(uri);
    await deleteRemovedBookMedia(bookWithImage(uri));
    expect(runtime.remove).not.toHaveBeenCalled();
  });
  it("deletes removed-book files but preserves files shared by another retained book", async () => {
    const shared = `${root}/shared.png`;
    const removed = bookWithImage(shared);
    removed.backendOriginalSource = {
      path: "narra-backend-sources/book.fb2",
      format: "fb2",
      hash: "hash",
    };
    runtime.books.retained = bookWithImage(shared);
    await deleteRemovedBookMedia(removed);
    expect(runtime.remove.mock.calls.map(([uri]) => uri)).toEqual([
      "file:///documents/narra-backend-sources/book.fb2",
    ]);
  });
  it("only accepts owned paths and rehomes old iOS containers", () => {
    const book = bookWithImage("file:///old/Documents/narra-media/image.png");
    book.scenes.one.videoUri = "file:///documents/narra-media/../books/book.epub";
    book.backendOriginalSource = { path: "books/user.epub", hash: "", format: "epub" };
    expect([...bookMediaFiles(book)]).toEqual(["file:///documents/narra-media/image.png"]);
  });
  it("removes only old unused downloads, preserving offline references and recent/in-flight files", async () => {
    for (const name of ["unused", "offline", "inflight", "recent"]) {
      runtime.files.set(`${root}/${name}.png`, {
        isDirectory: false,
        size: 123,
        modificationTime: name === "recent" ? Date.now() / 1000 : 0,
      });
    }
    runtime.books.offline = bookWithImage(`${root}/offline.png`);
    protectBackendMedia(`${root}/inflight.png`);
    expect(await clearUnusedBackendMedia()).toEqual({ deletedFiles: 1, deletedBytes: 123 });
    expect(runtime.remove.mock.calls.map(([uri]) => uri)).toEqual([`${root}/unused.png`]);
  });
  it("never sweeps before the persisted references have loaded", async () => {
    runtime.hydrated = false;
    runtime.files.set(`${root}/unused.png`, { isDirectory: false, size: 123, modificationTime: 0 });
    expect(await clearUnusedBackendMedia()).toEqual({ deletedFiles: 0, deletedBytes: 0 });
    expect(runtime.remove).not.toHaveBeenCalled();
  });
});
