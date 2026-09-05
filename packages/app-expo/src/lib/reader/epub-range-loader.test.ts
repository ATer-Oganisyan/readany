import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildStoreOnlyZip } from "@readany/core/utils/store-only-zip";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as zip from "../../../../foliate-js/vendor/zip.js";

const xml = '<container><rootfile full-path="book.opf"/></container>';
const bytes = buildStoreOnlyZip([
  { name: "unused/large.bin", data: new Uint8Array(2 * 1024 * 1024) },
  { name: "META-INF/container.xml", data: new TextEncoder().encode(xml) },
  { name: "chapter.xhtml", data: new TextEncoder().encode("<p>The river diary.</p>") },
]);
const html = readFileSync(
  new URL("../../../assets/reader/reader.template.html", import.meta.url),
  "utf8",
);
const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("\n  </script>"));
const source = ts.createSourceFile(
  "reader.js",
  script,
  ts.ScriptTarget.ESNext,
  true,
  ts.ScriptKind.JS,
);
function productionLoader() {
  const helper = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "loadEpubFromRanges",
  );
  if (!helper) throw new Error("Production range loader missing");
  return helper.getText(source);
}

function harness(
  options: {
    wrongStatus?: boolean;
    wrongRange?: boolean;
    truncated?: boolean;
    noRanges?: boolean;
    fetcher?: typeof fetch;
  } = {},
) {
  const requests: Array<{ offset: number; length: number }> = [];
  const init = vi.fn();
  const destroy = vi.fn();
  const fetcher =
    options.fetcher ??
    vi.fn(async (_url: string, request?: RequestInit) => {
      if (request?.method === "HEAD")
        return new Response(null, {
          headers: {
            "Content-Length": String(bytes.length),
            "Accept-Ranges": options.noRanges ? "none" : "bytes",
          },
        });
      const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(request?.headers).get("Range") ?? "");
      if (!range) throw new Error("Unexpected full-body download");
      const [, left, right] = range;
      const offset = Number(left);
      const end = Number(right);
      requests.push({ offset, length: end - offset + 1 });
      return new Response(bytes.slice(offset, options.truncated ? end : end + 1), {
        status: options.wrongStatus ? 200 : 206,
        headers: {
          "Content-Range": options.wrongRange
            ? "bytes 0-5/6"
            : `bytes ${offset}-${end}/${bytes.length}`,
        },
      });
    });
  class EPUB {
    sections = [];
    destroy = destroy;
    loader: {
      loadText: (name: string) => Promise<string>;
      loadBlob: (name: string, type: string) => Promise<Blob>;
    };
    constructor(loader: EPUB["loader"]) {
      this.loader = loader;
    }
    async init() {
      init();
      expect(await this.loader.loadText("META-INF/container.xml")).toBe(xml);
      expect(
        await (await this.loader.loadBlob("chapter.xhtml", "application/xhtml+xml")).text(),
      ).toBe("<p>The river diary.</p>");
      return this;
    }
  }
  const context = vm.createContext({
    window: { _zipJs: zip, _EPUB: EPUB },
    fetch: fetcher,
    Uint8Array,
    DOMException,
    AbortController,
    console: { warn: vi.fn() },
  });
  vm.runInContext(productionLoader(), context);
  return {
    fetcher,
    requests,
    init,
    destroy,
    load: (fileName = "large.epub", signal = new AbortController().signal) =>
      context.loadEpubFromRanges(
        { uri: "http://127.0.0.1:8084/book", fileName },
        signal,
      ) as Promise<EPUB | null>,
  };
}

describe("actual vendored ZIP range stream contract", () => {
  it("reads actual container/chapter entries without downloading the whole EPUB", async () => {
    const h = harness();
    const book = await h.load();
    expect(book).not.toBeNull();
    expect(h.requests.length).toBeGreaterThan(0);
    expect(h.requests.reduce((total, request) => total + request.length, 0)).toBeLessThan(4096);
    expect(
      h.requests.every(
        (request) =>
          request.length < 65557 &&
          request.offset >= 0 &&
          request.offset + request.length <= bytes.length,
      ),
    ).toBe(true);
    book?.destroy();
    expect(h.destroy).toHaveBeenCalledOnce();
  });

  it.each(["comic.cbz", "archive.fbz", "book.fb2.zip", "raw.fb2", "book.pdf"])(
    "does not route %s through an EPUB-only parser",
    async (name) => {
      const h = harness();
      expect(await h.load(name)).toBeNull();
      expect(h.fetcher).not.toHaveBeenCalled();
      expect(h.init).not.toHaveBeenCalled();
    },
  );

  it("keeps the existing full-fetch fallback when the server does not support ranges", async () => {
    const h = harness({ noRanges: true });
    expect(await h.load()).toBeNull();
    expect(h.requests).toHaveLength(0);
  });

  it.each(["wrongStatus", "wrongRange", "truncated"] as const)(
    "rejects %s instead of parsing unverified range bytes",
    async (problem) => {
      const h = harness({ [problem]: true });
      await expect(h.load()).rejects.toThrow();
    },
  );

  it("does not start network work with an already cancelled signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harness();
    await expect(h.load("large.epub", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("forwards cancellation to a stalled request and ignores its late response", async () => {
    const controller = new AbortController();
    let complete!: (response: Response) => void;
    let requestSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>((_url, options) => {
      requestSignal = options?.signal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const h = harness({ fetcher });
    const pending = h.load("large.epub", controller.signal);
    expect(requestSignal).toBe(controller.signal);
    controller.abort();
    complete(
      new Response(null, {
        headers: { "Content-Length": String(bytes.length), "Accept-Ranges": "bytes" },
      }),
    );
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(h.init).not.toHaveBeenCalled();
  });

  it("stops future entry requests when the book is destroyed or its open is cancelled", async () => {
    for (const reason of ["destroy", "abort"]) {
      const controller = new AbortController();
      const h = harness();
      const book = await h.load("large.epub", controller.signal);
      const count = h.requests.length;
      if (reason === "destroy") {
        book?.destroy();
        book?.destroy();
      } else controller.abort();
      await expect((async () => book?.loader.loadText("chapter.xhtml"))()).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(h.requests).toHaveLength(count);
      if (reason === "destroy") expect(h.destroy).toHaveBeenCalledOnce();
    }
  });
});
