import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Execute the actual store action without loading the native import/reader services.
function setup() {
  const source = ts.createSourceFile(
    "library-store.ts",
    readFileSync(new URL("../../stores/library-store.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let action: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "updateBook") {
      action = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!action) throw new Error("Missing updateBook action");
  let state = {
    books: [{ id: "book", progress: 0.5, currentCfi: "position", tags: ["old"] }],
    allTags: ["old"],
  };
  const set = vi.fn((update) => {
    state = { ...state, ...update(state) };
  });
  const save = vi.fn();
  const persist = vi.fn().mockResolvedValue(undefined);
  const js = ts.transpile(`const action = ${action.getText(source)};`, {
    target: ts.ScriptTarget.ESNext,
  });
  const updateBook = new Function(
    "get",
    "set",
    "debouncedSave",
    "persistBookUpdate",
    `${js}; return action;`,
  )(() => state, set, save, persist);
  return { getState: () => state, updateBook, set, save, persist };
}

describe("library progress publication", () => {
  it("keeps the same books and does not notify for unchanged progress, while allowing persistence retries", async () => {
    const store = setup();
    const before = store.getState().books;
    await store.updateBook("book", { progress: 0.5, currentCfi: "position" });
    expect(store.getState().books).toBe(before);
    expect(store.set).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.persist).toHaveBeenCalledOnce();
  });

  it("retries the same position after a failed database write without another render", async () => {
    const store = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      store.persist.mockRejectedValueOnce(new Error("database unavailable"));
      const updates = { progress: 0.6, currentCfi: "new-position" };
      await store.updateBook("book", updates);
      await store.updateBook("book", updates);
      expect(store.persist).toHaveBeenCalledTimes(2);
      expect(store.set).toHaveBeenCalledOnce();
      expect(store.getState().books[0]).toMatchObject(updates);
    } finally {
      error.mockRestore();
    }
  });

  it("publishes a new position synchronously before persistence completes", async () => {
    const store = setup();
    let finish!: () => void;
    store.persist.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const saving = store.updateBook("book", { progress: 0.6, currentCfi: "new-position" });
    expect(store.getState().books[0]).toMatchObject({ progress: 0.6, currentCfi: "new-position" });
    expect(store.persist).toHaveBeenCalledOnce();
    finish();
    await saving;
  });

  it("still adds newly assigned tags to the library", async () => {
    const store = setup();
    await store.updateBook("book", { tags: ["new"] });
    expect(store.getState().allTags).toEqual(["new", "old"]);
    expect(store.persist).toHaveBeenCalledWith("book", { tags: ["new"] });
  });
});
