import { buildStoreOnlyZip } from "@readany/core/utils/store-only-zip";
import { describe, expect, it } from "vitest";
import { validateBookImportSource } from "./metadata-extractor";

const utf8 = (text: string) => new TextEncoder().encode(text);
const file = (data: Uint8Array | string) =>
  new Blob([new Uint8Array(typeof data === "string" ? utf8(data) : data)]);
const fb2 =
  '<?xml version="1.0"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><body><section><title><p>Письмо</p></title><p>Анна и Михаил читают письмо.</p></section></body></FictionBook>';
const epub = (
  chapter = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Анна читает.</p></body></html>',
) =>
  buildStoreOnlyZip([
    { name: "mimetype", data: utf8("application/epub+zip") },
    {
      name: "META-INF/container.xml",
      data: utf8(
        '<container><rootfiles><rootfile full-path="EPUB/package.opf"/></rootfiles></container>',
      ),
    },
    {
      name: "EPUB/package.opf",
      data: utf8(
        '<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
      ),
    },
    { name: "EPUB/chapter.xhtml", data: utf8(chapter) },
  ]);

describe("native import container admission", () => {
  it("accepts valid EPUB without requiring optional title or cover", async () => {
    await expect(validateBookImportSource(file(epub()), "epub")).resolves.toBeUndefined();
  });
  it("rejects HTML masquerading as EPUB and ZIP without a reading spine", async () => {
    await expect(validateBookImportSource(file("<html>Sign in</html>"), "epub")).rejects.toThrow(
      /повреждён/,
    );
    await expect(
      validateBookImportSource(
        file(buildStoreOnlyZip([{ name: "a.txt", data: utf8("text") }])),
        "epub",
      ),
    ).rejects.toThrow(/повреждён/);
  });
  it("rejects truncated EPUB and damaged first chapter", async () => {
    await expect(validateBookImportSource(file(epub().slice(0, 80)), "epub")).rejects.toThrow(
      /повреждён/,
    );
    await expect(validateBookImportSource(file(epub("not a document")), "epub")).rejects.toThrow(
      /повреждён/,
    );
  });
  it("accepts FB2 including comments, CDATA and quoted greater-than signs", async () => {
    await expect(validateBookImportSource(file(fb2), "fb2")).resolves.toBeUndefined();
    const special = `${fb2.replace("<p>Анна", '<p id="x&gt;y" title="x>y"><![CDATA[Анна < читает]]> Анна')}<!-- ending -->`;
    await expect(validateBookImportSource(file(special), "fb2")).resolves.toBeUndefined();
  });
  it.each([
    "<FictionBook><body><section><p>truncated",
    "<FictionBook><body><section><p>text</section></p></body></FictionBook>",
    "<FictionBook><body><section><p> </p></section></body></FictionBook>",
    "<html><body>Sign in to download</body></html>",
  ])("rejects invalid FB2 structure", async (xml) => {
    await expect(validateBookImportSource(file(xml), "fb2")).rejects.toThrow(/повреждён/);
  });
  it("accepts nested FB2 archive and rejects wrong/empty archive", async () => {
    await expect(
      validateBookImportSource(
        file(buildStoreOnlyZip([{ name: "nested/book.fb2", data: utf8(fb2) }])),
        "fbz",
      ),
    ).resolves.toBeUndefined();
    await expect(
      validateBookImportSource(
        file(buildStoreOnlyZip([{ name: "nested/book.fb2", data: utf8("broken") }])),
        "fbz",
      ),
    ).rejects.toThrow(/повреждён/);
    await expect(
      validateBookImportSource(
        file(buildStoreOnlyZip([{ name: "readme.txt", data: utf8("text") }])),
        "cbz",
      ),
    ).rejects.toThrow(/повреждён/);
  });
  it("rejects PDF with missing signature or truncated trailer", async () => {
    await expect(validateBookImportSource(file("%PDF-1.4\ntruncated"), "pdf")).rejects.toThrow(
      /повреждён/,
    );
    await expect(validateBookImportSource(file("<html>no PDF</html>"), "pdf")).rejects.toThrow(
      /повреждён/,
    );
  });
  it("rejects empty source before any parser fallback", async () => {
    await expect(validateBookImportSource(file(""), "epub")).rejects.toMatchObject({
      code: "EMPTY_SOURCE",
    });
  });
});
