import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  BOOK_IMPORT_MIME_TYPES,
  bookImportFormat,
  bookImportPickerTypes,
} from "../book/import-format";

const source = readFileSync(new URL("../../screens/ReaderScreen.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "ReaderScreen.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let callback: ts.VariableDeclaration | undefined;
const helpers: ts.FunctionDeclaration[] = [];
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleReimportMissingBook")
    callback = node;
  if (
    ts.isFunctionDeclaration(node) &&
    ["normalizeBookIdentityText", "authorsLikelyMatch", "shouldConfirmReimportCandidate"].includes(
      node.name?.text ?? "",
    )
  )
    helpers.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
if (!callback?.initializer) throw new Error("Actual Reader missing-book callback missing");
const code = ts.transpileModule(
  `${helpers.map((node) => node.getText(ast)).join("\n")}\nglobalThis.reimport = ${callback.initializer.getText(ast)};`,
  {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  },
).outputText;

function harness(platform = "ios") {
  const book = { id: "existing-book", format: "cbz", meta: { title: "River", author: "Narra QA" } };
  const asset = { uri: "file:///provider/river.cbz", name: "river.cbz" };
  const pick = vi.fn().mockResolvedValue({ canceled: false, assets: [asset] });
  const inspect = vi.fn(async (_id: string, file: typeof asset) => ({
    title: "River",
    author: "Narra QA",
    format: bookImportFormat(file.name),
  }));
  const restore = vi.fn().mockResolvedValue(book);
  const prompt = vi.fn().mockResolvedValue(true);
  const setError = vi.fn();
  const setLoading = vi.fn();
  const setIsReimporting = vi.fn();
  const context = vm.createContext({
    Error,
    console: { error: vi.fn() },
    useCallback: (fn: unknown) => fn,
    bookImportPickerTypes,
    Platform: { OS: platform },
    DocumentPicker: { getDocumentAsync: pick },
    useLibraryStore: {
      getState: () => ({ inspectDeletedBookCandidate: inspect, reimportDeletedBook: restore }),
    },
    useMissingBookPromptStore: { getState: () => ({ showPrompt: prompt }) },
    book,
    bookId: book.id,
    isReimporting: false,
    setIsReimporting,
    setError,
    setLoading,
    t: (key: string) => key,
  });
  vm.runInContext(code, context);
  return {
    reimport: context.reimport as () => Promise<void>,
    asset,
    book,
    pick,
    inspect,
    restore,
    prompt,
    setError,
    setLoading,
    setIsReimporting,
  };
}

describe("actual Reader missing-file picker callback", () => {
  it("passes the iOS picker policy and waits for a selected CBZ restore before restarting the Reader", async () => {
    const h = harness();
    let complete!: (value: typeof h.book) => void;
    h.restore.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = h.reimport();
    await vi.waitFor(() => expect(h.restore).toHaveBeenCalledOnce());
    expect(h.pick).toHaveBeenCalledWith({
      type: ["*/*"],
      multiple: false,
      copyToCacheDirectory: true,
    });
    expect(h.inspect).toHaveBeenCalledWith(h.book.id, h.asset);
    expect(h.restore).toHaveBeenCalledWith(h.book.id, h.asset);
    expect(h.setLoading).not.toHaveBeenCalled();
    complete(h.book);
    await pending;
    expect(h.setError).toHaveBeenCalledWith(null);
    expect(h.setLoading).toHaveBeenCalledWith(true);
    expect(h.setIsReimporting.mock.calls).toEqual([[true], [false]]);
  });
  it("retains the Android MIME allowlist, including CBZ aliases, without a wildcard", async () => {
    const h = harness("android");
    await h.reimport();
    expect(h.pick.mock.calls[0][0].type).toEqual(BOOK_IMPORT_MIME_TYPES);
    expect(h.pick.mock.calls[0][0].type).not.toContain("*/*");
    expect(h.pick.mock.calls[0][0].type).toContain("application/x-cbz");
  });
  it("cancels the picker without inspecting, writing, or changing the current error", async () => {
    const h = harness();
    h.pick.mockResolvedValueOnce({ canceled: true, assets: null });
    await h.reimport();
    expect(h.inspect).not.toHaveBeenCalled();
    expect(h.restore).not.toHaveBeenCalled();
    expect(h.setError).not.toHaveBeenCalled();
    expect(h.setLoading).not.toHaveBeenCalled();
    expect(h.setIsReimporting).toHaveBeenLastCalledWith(false);
  });
  it("preserves mismatch confirmation and does not restore when the user declines", async () => {
    const h = harness();
    h.inspect.mockResolvedValueOnce({
      title: "Another book",
      author: "Other author",
      format: "pdf",
    });
    h.prompt.mockResolvedValueOnce(false);
    await h.reimport();
    expect(h.prompt).toHaveBeenCalledOnce();
    expect(h.restore).not.toHaveBeenCalled();
    expect(h.setLoading).not.toHaveBeenCalled();
    expect(h.setIsReimporting).toHaveBeenLastCalledWith(false);
  });
  it("still rejects unsupported wildcard selections through actual format admission", async () => {
    const h = harness();
    h.pick.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///provider/movie.mov", name: "movie.mov" }],
    });
    await h.reimport();
    expect(h.setError.mock.calls[0]?.[0]).toMatch(/не поддерживается/);
    expect(h.restore).not.toHaveBeenCalled();
    expect(h.setLoading).not.toHaveBeenCalled();
    expect(h.setIsReimporting).toHaveBeenLastCalledWith(false);
  });
  it("shows restore failure without reopening an invalid Reader and releases the retry state", async () => {
    const h = harness();
    h.restore.mockResolvedValueOnce(null);
    await h.reimport();
    expect(h.setError).toHaveBeenCalledWith("reader.reimportFailed");
    expect(h.setLoading).not.toHaveBeenCalled();
    expect(h.setIsReimporting).toHaveBeenLastCalledWith(false);
  });
  it("reports provider failure without touching the saved book", async () => {
    const h = harness();
    h.pick.mockRejectedValueOnce(new Error("Provider unavailable"));
    await h.reimport();
    expect(h.setError).toHaveBeenCalledWith("Provider unavailable");
    expect(h.restore).not.toHaveBeenCalled();
    expect(h.setLoading).not.toHaveBeenCalled();
    expect(h.setIsReimporting).toHaveBeenLastCalledWith(false);
  });
});
