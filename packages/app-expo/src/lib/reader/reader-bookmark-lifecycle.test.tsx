import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({
  bookmarks: [] as { id: string; bookId: string; cfi: string }[],
  addBookmark: vi.fn(),
  removeBookmark: vi.fn(),
}));
vi.mock("@/stores", () => ({ useAnnotationStore: () => store }));
vi.mock("@readany/core/utils", () => ({ generateId: vi.fn(() => `id-${Math.random()}`) }));
import { useReaderBookmark } from "../../screens/reader/useReaderBookmark";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let hook: ReturnType<typeof useReaderBookmark>;
let tree: ReactTestRenderer;
const request = vi.fn();
const added = vi.fn();
const removed = vi.fn();
const failed = vi.fn();
function Harness({ bookId = "a", cfi = "page-a" }) {
  hook = useReaderBookmark({
    bookId,
    currentCfi: cfi,
    currentChapter: "chapter",
    requestPageSnippet: request,
    onBookmarkAdded: added,
    onBookmarkRemoved: removed,
    onBookmarkError: failed,
  });
  return null;
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  store.bookmarks = [];
  store.addBookmark.mockResolvedValue(undefined);
  store.removeBookmark.mockResolvedValue(undefined);
  await act(async () => {
    tree = create(<Harness />);
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
  vi.useRealTimers();
});
async function snippet(text = "page text", cfi = "page-a") {
  await act(async () => hook.onBookmarkSnippet(text, request.mock.calls.at(-1)?.[0], cfi));
}
it("waits for durable acknowledgement before success and ignores repeated taps", async () => {
  let finish!: () => void;
  store.addBookmark.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => {
    hook.handleToggleBookmark();
    hook.handleToggleBookmark();
  });
  expect(request).toHaveBeenCalledTimes(1);
  await snippet();
  expect(added).not.toHaveBeenCalled();
  await act(async () => hook.handleToggleBookmark());
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(added).toHaveBeenCalledTimes(1);
});
it("retains the requested page when the reader moves before the snippet arrives", async () => {
  await act(async () => hook.handleToggleBookmark());
  await act(async () => tree.update(<Harness cfi="page-b" />));
  await snippet("wrong page", "page-b");
  expect(store.addBookmark).toHaveBeenCalledWith(
    expect.objectContaining({ bookId: "a", cfi: "page-a", label: undefined }),
  );
});
it("ignores unrelated snippet responses and falls back to the original anchor", async () => {
  await act(async () => hook.handleToggleBookmark());
  await act(async () => hook.onBookmarkSnippet("stale", "old-request", "page-a"));
  expect(store.addBookmark).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(store.addBookmark).toHaveBeenCalledWith(
    expect.objectContaining({ cfi: "page-a", label: undefined }),
  );
});
it("reports failed writes without success and allows a new attempt", async () => {
  store.addBookmark.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => hook.handleToggleBookmark());
  await snippet();
  expect(added).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledTimes(1);
  await act(async () => hook.handleToggleBookmark());
  await snippet();
  expect(added).toHaveBeenCalledTimes(1);
});
it("does not claim successful deletion when the database rejects it", async () => {
  store.bookmarks = [{ id: "saved", bookId: "a", cfi: "page-a" }];
  store.removeBookmark.mockRejectedValueOnce(new Error("locked"));
  await act(async () => tree.update(<Harness />));
  await act(async () => hook.handleToggleBookmark());
  expect(removed).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledTimes(1);
});
it("commits captured intent on exit without a late success toast or timer", async () => {
  await act(async () => hook.handleToggleBookmark());
  await act(async () => tree.unmount());
  expect(store.addBookmark).toHaveBeenCalledWith(expect.objectContaining({ cfi: "page-a" }));
  expect(added).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
