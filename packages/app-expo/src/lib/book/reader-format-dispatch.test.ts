import { buildStoreOnlyZip } from "@readany/core/utils/store-only-zip";
import { afterAll, expect, it, vi } from "vitest";

vi.stubGlobal("HTMLElement", class {});
vi.stubGlobal("NodeFilter", { SHOW_ELEMENT: 1, SHOW_TEXT: 4, SHOW_CDATA_SECTION: 8 });
vi.stubGlobal("customElements", { define: vi.fn(), get: vi.fn() });
vi.mock("../../../../foliate-js/fb2.js", () => ({
  makeFB2: async (blob: Blob) => ({ kind: "fb2", text: await blob.text() }),
}));
vi.mock("../../../../foliate-js/epub.js", () => ({
  EPUB: class {
    async init() {
      return { kind: "epub" };
    }
  },
}));
vi.mock("../../../../foliate-js/comic-book.js", () => ({
  makeComicBook: () => ({ kind: "cbz" }),
}));
vi.mock("../../../../foliate-js/pdf.js", () => ({
  makePDF: () => ({ kind: "pdf" }),
}));
const { makeBook } = await import("../../../../foliate-js/view.js");
afterAll(() => vi.unstubAllGlobals());

it.each(["BOOK.FB2.ZIP", "BOOK.FBZ"])(
  "reads the FB2 entry in %s instead of the first archive entry",
  async (name) => {
    const bytes = buildStoreOnlyZip([
      { name: "books/", data: new Uint8Array() },
      { name: "__MACOSX/._BOOK.FB2", data: new Uint8Array([1, 2, 3]) },
      { name: "cover.jpg", data: new Uint8Array([1, 2, 3]) },
      { name: "books/BOOK.FB2", data: new TextEncoder().encode("<FictionBook/>") },
    ]);
    expect(await makeBook(new File([Uint8Array.from(bytes)], name))).toEqual({
      kind: "fb2",
      text: "<FictionBook/>",
    });
  },
);
it("rejects an FBZ without an FB2 instead of parsing a random entry", async () => {
  const bytes = buildStoreOnlyZip([{ name: "cover.jpg", data: new Uint8Array([1]) }]);
  await expect(makeBook(new File([Uint8Array.from(bytes)], "BOOK.FBZ"))).rejects.toThrow(
    "no FB2 document",
  );
});
it("recognizes uppercase plain FB2, EPUB, CBZ and PDF with generic MIME types", async () => {
  expect(await makeBook(new File(["<FictionBook/>"], "BOOK.FB2"))).toMatchObject({ kind: "fb2" });
  expect(await makeBook(new File(["%PDF-1.4"], "BOOK.PDF"))).toMatchObject({ kind: "pdf" });
  const zip = buildStoreOnlyZip([{ name: "test", data: new Uint8Array([1]) }]);
  expect(await makeBook(new File([Uint8Array.from(zip)], "BOOK.CBZ"))).toMatchObject({
    kind: "cbz",
  });
  expect(await makeBook(new File([Uint8Array.from(zip)], "BOOK.EPUB"))).toMatchObject({
    kind: "epub",
  });
});
