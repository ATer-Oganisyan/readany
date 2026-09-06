import { afterEach, beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  insertBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
  getBookmarks: vi.fn(),
  getHighlights: vi.fn(),
  getNotes: vi.fn(),
}));
vi.mock("../db/database", () => db);
import { useAnnotationStore } from "./annotation-store";
const bookmark = { id: "bm-a", bookId: "a", cfi: "cfi-a", createdAt: 1 };
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useAnnotationStore.setState({ activeBookId: "a", bookmarks: [], highlights: [], notes: [] });
  db.insertBookmark.mockResolvedValue(undefined);
  db.deleteBookmark.mockResolvedValue(undefined);
  db.getBookmarks.mockResolvedValue([]);
  db.getHighlights.mockResolvedValue([]);
  db.getNotes.mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());
it("publishes a bookmark only after its write is acknowledged", async () => {
  const write = deferred();
  db.insertBookmark.mockReturnValueOnce(write.promise);
  const saved = useAnnotationStore.getState().addBookmark(bookmark);
  expect(useAnnotationStore.getState().bookmarks).toEqual([]);
  write.resolve();
  await saved;
  expect(useAnnotationStore.getState().bookmarks).toEqual([bookmark]);
});
it("rejects failed inserts without a phantom and allows retry", async () => {
  db.insertBookmark.mockRejectedValueOnce(new Error("disk full"));
  await expect(useAnnotationStore.getState().addBookmark(bookmark)).rejects.toThrow("disk full");
  expect(useAnnotationStore.getState().bookmarks).toEqual([]);
  await useAnnotationStore.getState().addBookmark(bookmark);
  expect(useAnnotationStore.getState().bookmarks).toEqual([bookmark]);
});
it("keeps the saved bookmark when delete fails", async () => {
  useAnnotationStore.setState({ bookmarks: [bookmark] });
  db.deleteBookmark.mockRejectedValueOnce(new Error("locked"));
  await expect(useAnnotationStore.getState().removeBookmark(bookmark.id)).rejects.toThrow("locked");
  expect(useAnnotationStore.getState().bookmarks).toEqual([bookmark]);
});
it("does not publish a late write into another book", async () => {
  const write = deferred();
  db.insertBookmark.mockReturnValueOnce(write.promise);
  const saved = useAnnotationStore.getState().addBookmark(bookmark);
  useAnnotationStore.setState({ activeBookId: "b", bookmarks: [] });
  write.resolve();
  await saved;
  expect(useAnnotationStore.getState().bookmarks).toEqual([]);
});
it("does not let an old database read undo a committed insert", async () => {
  const read = deferred<(typeof bookmark)[]>();
  db.getBookmarks.mockReturnValueOnce(read.promise).mockResolvedValue([bookmark]);
  const loading = useAnnotationStore.getState().loadAnnotations("a");
  await vi.waitFor(() => expect(db.getBookmarks).toHaveBeenCalled());
  await useAnnotationStore.getState().addBookmark(bookmark);
  read.resolve([]);
  await loading;
  expect(useAnnotationStore.getState().bookmarks).toEqual([bookmark]);
});
it("serializes delete after an in-flight insert", async () => {
  const write = deferred();
  db.insertBookmark.mockReturnValueOnce(write.promise);
  const saved = useAnnotationStore.getState().addBookmark(bookmark);
  const removed = useAnnotationStore.getState().removeBookmark(bookmark.id);
  await Promise.resolve();
  expect(db.deleteBookmark).not.toHaveBeenCalled();
  write.resolve();
  await saved;
  await removed;
  expect(useAnnotationStore.getState().bookmarks).toEqual([]);
});
