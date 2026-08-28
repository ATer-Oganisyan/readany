import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { isCharacterUnlocked } from "./domain";

const source = ts.createSourceFile(
  "ReaderScreen.tsx",
  readFileSync(new URL("../../screens/ReaderScreen.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

// Execute the actual reader callbacks without mounting its WebView/native dependencies.
function callback(name: string, bindings: Record<string, unknown>) {
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === name) {
      expression = node.initializer;
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      expression = ts.isCallExpression(node.initializer)
        ? node.initializer.arguments[0]
        : node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!expression) throw new Error(`Missing callback ${name}`);
  const js = ts.transpile(`const handler = ${expression.getText(source)};`, {
    target: ts.ScriptTarget.ESNext,
  });
  return new Function(...Object.keys(bindings), `${js}; return handler;`)(
    ...Object.values(bindings),
  );
}

function setup(progress = 0.5, unlockProgress = 0.5, cfi = "epubcfi(/6/4)") {
  const library = { progress: 0.49, currentCfi: "previous" };
  const character = { id: "hero", unlockProgress };
  const updateBook = vi.fn((_id, updates) => {
    Object.assign(library, updates);
    // Persistence may take time; navigation must not wait for it.
    return new Promise(() => {});
  });
  const publishCharacterProgress = callback("publishCharacterProgress", {
    updateBook,
    bookId: "book",
    progress,
    lastCfiRef: { current: cfi },
  });
  const navigate = vi.fn(() => {
    expect(library.progress).toBe(progress);
    expect(isCharacterUnlocked(library.progress, character)).toBe(true);
  });
  const bindings = {
    bookId: "book",
    characters: [character],
    progress,
    isCharacterUnlocked,
    suppressReaderTapUntilRef: { current: 0 },
    publishCharacterProgress,
    navigation: { navigate },
    charactersSheetSourceId: "reader",
  };
  return { library, updateBook, navigate, bindings, publishCharacterProgress };
}

describe("character entry uses the current reading position", () => {
  it("publishes a just-unlocked character's progress before the first profile opens", () => {
    const { bindings, navigate, library } = setup();
    callback("onCharacterTap", bindings)({ characterId: "hero" });
    expect(navigate).toHaveBeenCalledWith("NarraCharacterProfile", {
      bookId: "book",
      characterId: "hero",
    });
    expect(library.currentCfi).toBe("epubcfi(/6/4)");
  });

  it("publishes progress before opening the characters list and its chats", () => {
    const { bindings, navigate } = setup();
    callback("handleOpenCharacters", bindings)();
    expect(navigate).toHaveBeenCalledWith("NarraCharacters", {
      bookId: "book",
      charactersSheetSourceId: "reader",
    });
  });

  it.each(["hero", "unknown"])("does not open a locked or missing character (%s)", (id) => {
    const { bindings, navigate, updateBook } = setup(0.49, 0.5);
    callback("onCharacterTap", bindings)({ characterId: id });
    expect(navigate).not.toHaveBeenCalled();
    expect(updateBook).not.toHaveBeenCalled();
  });

  it("does not reset saved progress before the reader restores its location", () => {
    const { publishCharacterProgress, library, updateBook } = setup(0, 0.5, "");
    publishCharacterProgress();
    expect(updateBook).not.toHaveBeenCalled();
    expect(library.progress).toBe(0.49);
    expect(library.currentCfi).toBe("previous");
  });
});
