import { readFileSync } from "node:fs";
import vm from "node:vm";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReaderBridge } from "../../hooks/use-reader-bridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
  vi.useRealTimers();
});

function harness(onBookmarkSnippet = vi.fn()) {
  let bridge!: ReturnType<typeof useReaderBridge>;
  const messages: string[] = [];
  let visibleText = "";
  const runtime = vm.createContext({
    window: {
      getVisibleText: () => JSON.stringify({ text: visibleText }),
      getVisibleReadingContext: () => ({ text: visibleText, cfi: "epubcfi(/6/2!/4/2:8)" }),
      doGetChapterParagraphs: (requestId?: string) => {
        messages.push(
          JSON.stringify({
            type: "chapterParagraphs",
            requestId,
            paragraphs: [{ id: "p", text: visibleText, tagName: "p" }],
          }),
        );
      },
      ReactNativeWebView: { postMessage: (message: string) => messages.push(message) },
    },
    handleCommand() {},
    view: { lastLocation: { cfi: "epubcfi(/6/2!/4/2:8)" } },
    getVisibleTextSnippet: () => visibleText,
    doGetVisibleReadingContext: () => ({ text: visibleText, cfi: "epubcfi(/6/2!/4/2:8)" }),
    postToRN: (type: string, data: object) => messages.push(JSON.stringify({ type, ...data })),
  });
  const html = readFileSync(
    new URL("../../../assets/reader/reader.template.html", import.meta.url),
    "utf8",
  );
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
  const ast = ts.createSourceFile(
    "reader.js",
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const snippet = ast.statements.find(
    (node) =>
      ts.isExpressionStatement(node) &&
      ts.isBinaryExpression(node.expression) &&
      node.expression.left.getText(ast) === "window.requestPageSnippet",
  );
  if (!snippet) throw new Error("Missing actual bookmark snippet implementation");
  vm.runInContext(snippet.getText(ast), runtime);
  function Harness() {
    bridge = useReaderBridge({ onBookmarkSnippet });
    return null;
  }
  act(() => {
    tree = create(<Harness />);
  });
  bridge.webViewRef.current = {
    injectJavaScript: (code: string) => vm.runInContext(code, runtime),
  } as never;
  return {
    bridge,
    text(value: string) {
      visibleText = value;
    },
    deliver(index: number) {
      bridge.handleMessage({ nativeEvent: { data: messages[index] } });
    },
  };
}

describe("reader text requests", () => {
  it("round-trips bookmark request identity and actual page CFI through the WebView", () => {
    const received = vi.fn();
    const h = harness(received);
    const requestId = 'bookmark-"quoted"';
    h.text("Именно эта страница");
    h.bridge.requestPageSnippet(requestId);
    h.deliver(0);
    expect(received).toHaveBeenCalledExactlyOnceWith(
      "Именно эта страница",
      requestId,
      "epubcfi(/6/2!/4/2:8)",
    );
  });
  it("exact context is bounded at 600ms and a stale response cannot satisfy the next request", async () => {
    const h = harness();
    h.text("Старая страница");
    const old = h.bridge.getVisibleReadingContext();
    await vi.advanceTimersByTimeAsync(600);
    expect(await old).toBeNull();
    h.text("Новая страница");
    const next = h.bridge.getVisibleReadingContext();
    h.deliver(0);
    h.deliver(1);
    expect(await next).toEqual({ text: "Новая страница", cfi: "epubcfi(/6/2!/4/2:8)" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("invalidates exact context when the book is replaced or the screen closes", async () => {
    const h = harness();
    const old = h.bridge.getVisibleReadingContext();
    h.bridge.openBook({ base64: "YQ==", fileName: "next.epub" });
    expect(await old).toBeNull();
    const next = h.bridge.getVisibleReadingContext();
    act(() => tree?.unmount());
    expect(await next).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("settles pending work on book replacement and ignores the old response", async () => {
    const h = harness();
    h.text("Старая книга");
    const oldResult = vi.fn();
    void h.bridge.getVisibleText().then(oldResult);
    h.bridge.openBook({ base64: "YQ==", fileName: "next.epub" });
    h.text("Новая книга");
    const newResult = vi.fn();
    void h.bridge.getVisibleText().then(newResult);
    h.deliver(0);
    h.deliver(1);
    await Promise.resolve();
    expect(oldResult).toHaveBeenCalledExactlyOnceWith("");
    expect(newResult).toHaveBeenCalledExactlyOnceWith("Новая книга");
    expect(vi.getTimerCount()).toBe(0);
  });

  for (const method of ["getVisibleText", "getChapterParagraphs"] as const) {
    it(`${method}: concurrent responses go to their own caller, even out of order`, async () => {
      const h = harness();
      h.text("Первый запрос");
      const first = vi.fn();
      void h.bridge[method]().then(first);
      h.text("Второй запрос");
      const second = vi.fn();
      void h.bridge[method]().then(second);
      h.deliver(1);
      h.deliver(0);
      await vi.advanceTimersByTimeAsync(6000);
      const result = (text: string) =>
        method === "getVisibleText" ? text : [{ id: "p", text, tagName: "p" }];
      expect(first).toHaveBeenCalledExactlyOnceWith(result("Первый запрос"));
      expect(second).toHaveBeenCalledExactlyOnceWith(result("Второй запрос"));
    });

    it(`${method}: late timed-out response cannot replace a newer result`, async () => {
      const h = harness();
      h.text("Устаревший текст");
      void h.bridge[method]();
      await vi.advanceTimersByTimeAsync(6000);
      h.text("Новая страница");
      const result = vi.fn();
      void h.bridge[method]().then(result);
      h.deliver(0);
      h.deliver(1);
      await Promise.resolve();
      expect(result).toHaveBeenCalledExactlyOnceWith(
        method === "getVisibleText"
          ? "Новая страница"
          : [{ id: "p", text: "Новая страница", tagName: "p" }],
      );
    });
  }

  it("settles outstanding readers immediately when closing the screen", async () => {
    const h = harness();
    const visible = vi.fn();
    const chapter = vi.fn();
    void h.bridge.getVisibleText().then(visible);
    void h.bridge.getChapterParagraphs().then(chapter);
    act(() => tree?.unmount());
    await Promise.resolve();
    expect(visible).toHaveBeenCalledExactlyOnceWith("");
    expect(chapter).toHaveBeenCalledExactlyOnceWith([]);
  });
});
