import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";

// Execute the actual component handlers, with only their UI/DB ports replaced.
function handler(file: string, name: string, ports: Record<string, unknown>) {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL(`../../../app/src/components/reader/${file}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression = "";
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer)
      expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!expression) throw new Error(`Missing actual handler ${name}`);
  const javascript = ts.transpileModule(`const actual = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(ports), `${javascript}; return actual;`)(
    ...Object.values(ports),
  ) as (...args: string[]) => Promise<void>;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function ports() {
  return {
    currentCfi: "page-a",
    bookId: "book-a",
    isBookmarked: false,
    existingBookmark: undefined as { id: string } | undefined,
    bookmarkPendingRef: { current: false },
    setBookmarkPending: vi.fn(),
    pendingDeletes: { current: new Set<string>() },
    addBookmark: vi.fn().mockResolvedValue(undefined),
    removeBookmark: vi.fn().mockResolvedValue(undefined),
    getPageSnippet: () => "text",
    tab: { chapterTitle: "chapter" },
    generateId: () => "bookmark-a",
    toast: { success: vi.fn(), error: vi.fn() },
    t: (key: string) => key,
  };
}
it("desktop toolbar waits for durable insert and ignores a double click", async () => {
  const p = ports();
  const save = deferred();
  p.addBookmark.mockReturnValue(save.promise);
  const click = handler("ReaderToolbar.tsx", "handleToggleBookmark", p);
  const saving = click();
  await click();
  expect(p.addBookmark).toHaveBeenCalledTimes(1);
  expect(p.toast.success).not.toHaveBeenCalled();
  expect(p.bookmarkPendingRef.current).toBe(true);
  save.resolve();
  await saving;
  expect(p.toast.success).toHaveBeenCalledWith("bookmarks.added");
  expect(p.bookmarkPendingRef.current).toBe(false);
});
it("desktop toolbar reports insert failure and permits retry", async () => {
  const p = ports();
  p.addBookmark.mockRejectedValueOnce(new Error("disk full"));
  const click = handler("ReaderToolbar.tsx", "handleToggleBookmark", p);
  await click();
  expect(p.toast.success).not.toHaveBeenCalled();
  expect(p.toast.error).toHaveBeenCalledWith("bookmarks.saveFailed");
  await click();
  expect(p.toast.success).toHaveBeenCalledWith("bookmarks.added");
});
it("desktop toolbar does not report a rejected removal as successful", async () => {
  const p = ports();
  p.isBookmarked = true;
  p.existingBookmark = { id: "saved" };
  p.removeBookmark.mockRejectedValueOnce(new Error("locked"));
  await handler("ReaderToolbar.tsx", "handleToggleBookmark", p)();
  expect(p.toast.success).not.toHaveBeenCalled();
  expect(p.toast.error).toHaveBeenCalledWith("bookmarks.saveFailed");
  expect(p.bookmarkPendingRef.current).toBe(false);
});
it("desktop bookmark list serializes repeated removal of the same item", async () => {
  const p = ports();
  const save = deferred();
  p.removeBookmark.mockReturnValue(save.promise);
  const click = handler("TOCPanel.tsx", "handleDeleteBookmark", p);
  const saving = click("saved");
  await click("saved");
  expect(p.removeBookmark).toHaveBeenCalledTimes(1);
  expect(p.toast.success).not.toHaveBeenCalled();
  save.resolve();
  await saving;
  expect(p.toast.success).toHaveBeenCalledWith("bookmarks.removed");
  expect(p.pendingDeletes.current.size).toBe(0);
});
it("desktop bookmark list reports deletion failure and permits retry", async () => {
  const p = ports();
  p.removeBookmark.mockRejectedValueOnce(new Error("locked"));
  const click = handler("TOCPanel.tsx", "handleDeleteBookmark", p);
  await click("saved");
  expect(p.toast.success).not.toHaveBeenCalled();
  expect(p.toast.error).toHaveBeenCalledWith("bookmarks.saveFailed");
  await click("saved");
  expect(p.toast.success).toHaveBeenCalledWith("bookmarks.removed");
});
