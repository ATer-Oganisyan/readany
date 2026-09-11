import { expect, it } from "vitest";
import { decodeFB2 } from "../../../../foliate-js/fb2.js";
import { extractFb2Metadata, extractFb2MetadataFromFile } from "./metadata-extractor";

const title = "Книга о ёжике";
const source = (encoding: string) =>
  `<?xml version="1.0" encoding="${encoding}"?><FictionBook><description><title-info><book-title>${title}</book-title><author><first-name>Иван</first-name><last-name>Петров</last-name></author><lang>ru</lang></title-info></description><body><section><p>Он вошёл в дом.</p></section></body></FictionBook>`;
const cp1251 = (text: string) =>
  Uint8Array.from(
    [...text].map((c) =>
      c === "ё"
        ? 0xb8
        : c.charCodeAt(0) >= 0x0410
          ? c.charCodeAt(0) - 0x0410 + 0xc0
          : c.charCodeAt(0),
    ),
  );

it("decodes declared Windows-1251 consistently for metadata and reader", () => {
  const bytes = cp1251(source("windows-1251"));
  expect(extractFb2Metadata(bytes).title).toBe(title);
  expect(extractFb2Metadata(bytes).author).toBe("Иван Петров");
  expect(decodeFB2(bytes.buffer)).toBe(source("windows-1251"));
});
it.each(["le", "be"])("opens UTF-16%s FB2 with BOM in metadata and reader", (endian) => {
  const content = Buffer.from(source("UTF-16"), "utf16le");
  const bytes = Uint8Array.from(
    Buffer.concat([
      Buffer.from(endian === "le" ? [0xff, 0xfe] : [0xfe, 0xff]),
      endian === "le" ? content : content.swap16(),
    ]),
  );
  expect(extractFb2Metadata(bytes).title).toBe(title);
  expect(decodeFB2(bytes.buffer)).toBe(source("UTF-16"));
});
it("preserves UTF-8 and rejects a broken declared encoding instead of mojibake", () => {
  const bytes = new TextEncoder().encode(source("UTF-8"));
  expect(extractFb2Metadata(bytes).title).toBe(title);
  expect(decodeFB2(bytes.buffer)).toBe(source("UTF-8"));
  const broken = cp1251(source("UTF-8"));
  expect(() => decodeFB2(broken.buffer)).toThrow();
});

it("uses a UTF-8 BOM consistently even with an outdated encoding declaration", () => {
  const bytes = new TextEncoder().encode(`\uFEFF${source("windows-1251")}`);
  expect(extractFb2Metadata(bytes).title).toBe(title);
  expect(decodeFB2(bytes.buffer)).toBe(source("windows-1251"));
});

it("keeps metadata when a range read ends inside a UTF-8 character", async () => {
  const prefix = source("UTF-8").replace("</FictionBook>", "");
  const headSize = new TextEncoder().encode(prefix).length;
  const text = `${prefix}${" ".repeat(2 * 1024 * 1024 - headSize - 1)}ёжик</FictionBook>`;
  const metadata = await extractFb2MetadataFromFile(new File([text], "book.fb2"), "book.fb2");
  expect(metadata.title).toBe(title);
});
