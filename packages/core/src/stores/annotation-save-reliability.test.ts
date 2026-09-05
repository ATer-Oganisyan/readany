import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HighlightWithBook } from "../db/database";
import type { Highlight } from "../types";

const db = vi.hoisted(() => ({
  insertHighlight: vi.fn(),
  updateHighlight: vi.fn(),
  getAllHighlightsWithBooks: vi.fn(),
  getHighlightStats: vi.fn(),
  getHighlights: vi.fn(),
  getNotes: vi.fn(),
  getBookmarks: vi.fn(),
  getAllHighlights: vi.fn(),
}));
vi.mock("../db/database", () => db);

import { useAnnotationStore } from "./annotation-store";

const original: Highlight = {
  id: "note-a",
  bookId: "book-a",
  cfi: "",
  text: "",
  color: "yellow",
  note: "Saved body",
  chapterTitle: "Заметка к книге",
  createdAt: 100,
  updatedAt: 100,
};
const originalWithBook: HighlightWithBook = {
  ...original,
  bookTitle: "Book A",
  bookAuthor: "Author",
};
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useAnnotationStore.setState({
    activeBookId: null,
    highlights: [],
    highlightsWithBooks: [],
    stats: null,
  });
  db.insertHighlight.mockResolvedValue(undefined);
  db.updateHighlight.mockResolvedValue(undefined);
  db.getAllHighlightsWithBooks.mockResolvedValue([originalWithBook]);
  db.getHighlightStats.mockResolvedValue(null);
  db.getHighlights.mockResolvedValue([]);
  db.getNotes.mockResolvedValue([]);
  db.getBookmarks.mockResolvedValue([]);
  db.getAllHighlights.mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("annotation saves acknowledge committed database state", () => {
  it("does not publish a delayed book A insert into the newly loaded book B collection", async () => {
    const bookB = { ...original, id: "note-b", bookId: "book-b", note: "B only" };
    const write = deferred();
    db.insertHighlight.mockReturnValueOnce(write.promise);
    const savingA = useAnnotationStore.getState().addHighlight(original);
    db.getHighlights.mockResolvedValueOnce([bookB]);
    await useAnnotationStore.getState().loadAnnotations("book-b");
    write.resolve();
    await savingA;
    expect(useAnnotationStore.getState().highlights).toEqual([bookB]);
  });

  it("ignores a slow book A load after book B has become the current annotation scope", async () => {
    let finishA!: (rows: Highlight[]) => void;
    db.getHighlights.mockReturnValueOnce(
      new Promise<Highlight[]>((resolve) => {
        finishA = resolve;
      }),
    );
    const loadingA = useAnnotationStore.getState().loadAnnotations("book-a");
    const bookB = { ...original, id: "note-b", bookId: "book-b" };
    db.getHighlights.mockResolvedValueOnce([bookB]);
    await useAnnotationStore.getState().loadAnnotations("book-b");
    finishA([original]);
    await loadingA;
    expect(useAnnotationStore.getState().highlights).toEqual([bookB]);
  });

  it("clears old book overlays even when loading the new book fails", async () => {
    db.getHighlights.mockResolvedValueOnce([original]);
    await useAnnotationStore.getState().loadAnnotations("book-a");
    db.getHighlights.mockRejectedValueOnce(new Error("read failed"));
    await useAnnotationStore.getState().loadAnnotations("book-b");
    expect(useAnnotationStore.getState().highlights).toEqual([]);
  });

  it("does not let an older global highlights load replace a newer reader-book load", async () => {
    let finishGlobal!: (rows: Highlight[]) => void;
    db.getAllHighlights.mockReturnValueOnce(
      new Promise<Highlight[]>((resolve) => {
        finishGlobal = resolve;
      }),
    );
    const all = useAnnotationStore.getState().loadAllHighlights();
    const bookB = { ...original, id: "note-b", bookId: "book-b" };
    db.getHighlights.mockResolvedValueOnce([bookB]);
    await useAnnotationStore.getState().loadAnnotations("book-b");
    finishGlobal([original, bookB]);
    await all;
    expect(useAnnotationStore.getState().highlights).toEqual([bookB]);
  });

  it("does not publish a new note before its INSERT succeeds", async () => {
    const write = deferred();
    db.insertHighlight.mockReturnValueOnce(write.promise);
    const saving = useAnnotationStore.getState().addHighlight(original);
    const beforeCommit = [...useAnnotationStore.getState().highlights];
    write.resolve();
    await saving;
    expect(beforeCommit).toEqual([]);
    expect(useAnnotationStore.getState().highlights).toEqual([original]);
  });

  it("rejects failed new-note INSERT without creating a phantom note", async () => {
    const error = new Error("SQLITE_FULL");
    db.insertHighlight.mockRejectedValueOnce(error);
    await expect(useAnnotationStore.getState().addHighlight(original)).rejects.toBe(error);
    expect(useAnnotationStore.getState().highlights).toEqual([]);
    expect(db.getAllHighlightsWithBooks).not.toHaveBeenCalled();
  });

  it("returns a pending acknowledgement and leaves both collections unchanged until UPDATE", async () => {
    useAnnotationStore.setState({
      highlights: [original],
      highlightsWithBooks: [originalWithBook],
    });
    const write = deferred();
    db.updateHighlight.mockReturnValueOnce(write.promise);
    db.getAllHighlightsWithBooks.mockResolvedValue([{ ...originalWithBook, note: "New body" }]);
    const saving = useAnnotationStore.getState().updateHighlight(original.id, { note: "New body" });
    const during = useAnnotationStore.getState();
    write.resolve();
    await saving;
    expect(saving).toBeInstanceOf(Promise);
    expect(during.highlights[0].note).toBe("Saved body");
    expect(during.highlightsWithBooks[0].note).toBe("Saved body");
    expect(useAnnotationStore.getState().highlights[0].note).toBe("New body");
  });

  it("rejects failed UPDATE and keeps the persisted note visible instead of a false success", async () => {
    useAnnotationStore.setState({
      highlights: [original],
      highlightsWithBooks: [originalWithBook],
    });
    const error = new Error("disk I/O error");
    db.updateHighlight.mockRejectedValueOnce(error);
    const outcome = await Promise.resolve(
      useAnnotationStore.getState().updateHighlight(original.id, { note: "Unsaved body" }),
    ).then(
      () => "resolved",
      (reason: unknown) => reason,
    );
    expect(outcome).toBe(error);
    expect(useAnnotationStore.getState().highlights).toEqual([original]);
    expect(useAnnotationStore.getState().highlightsWithBooks).toEqual([originalWithBook]);
  });

  it("serializes two edits so a slower first write cannot overwrite the newer body", async () => {
    useAnnotationStore.setState({
      highlights: [original],
      highlightsWithBooks: [originalWithBook],
    });
    const first = deferred();
    db.updateHighlight.mockReturnValueOnce(first.promise);
    const older = useAnnotationStore.getState().updateHighlight(original.id, { note: "Older" });
    const newer = useAnnotationStore.getState().updateHighlight(original.id, { note: "Newer" });
    await Promise.resolve();
    const startedBeforeFirstCommit = db.updateHighlight.mock.calls.length;
    first.resolve();
    await Promise.all([older, newer]);
    expect(startedBeforeFirstCommit).toBe(1);
    expect(db.updateHighlight.mock.calls.map((call) => call[1].note)).toEqual(["Older", "Newer"]);
    expect(useAnnotationStore.getState().highlights[0].note).toBe("Newer");
  });

  it("does not poison later saves after a rejected write ignored by a legacy caller", async () => {
    useAnnotationStore.setState({
      highlights: [original],
      highlightsWithBooks: [originalWithBook],
    });
    db.updateHighlight.mockRejectedValueOnce(new Error("SQLITE_FULL"));
    // Production legacy callers intentionally do not await; the store still
    // observes the rejection without changing what awaited callers receive.
    useAnnotationStore.getState().updateHighlight(original.id, { note: "Rejected" });
    await useAnnotationStore.getState().updateHighlight(original.id, { note: "Retry" });
    expect(useAnnotationStore.getState().highlights[0].note).toBe("Retry");
  });

  it("keeps a committed update successful when only the derived read fails", async () => {
    useAnnotationStore.setState({
      highlights: [original],
      highlightsWithBooks: [originalWithBook],
    });
    db.getAllHighlightsWithBooks.mockRejectedValueOnce(new Error("refresh failed"));
    await expect(
      useAnnotationStore.getState().updateHighlight(original.id, { note: "Committed" }),
    ).resolves.toBeUndefined();
    expect(useAnnotationStore.getState().highlights[0].note).toBe("Committed");
    expect(useAnnotationStore.getState().highlightsWithBooks[0].note).toBe("Committed");
  });
});
