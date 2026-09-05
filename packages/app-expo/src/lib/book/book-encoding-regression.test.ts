import { readFileSync } from "node:fs";
import vm from "node:vm";
import { TxtToEpubConverter } from "@readany/core/utils/txt-to-epub";
import { DOMParser } from "@xmldom/xmldom";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { extractEpubMetadata, extractFb2Metadata } from "./metadata-extractor";
import { ensureTxtUtf8Bytes } from "./txt-encoding";

const NativeDecoder = globalThis.TextDecoder;
const title = "Аудит — Письмо Windows";
const body =
  "Анна вошла в комнату и увидела, что на столе лежит книга. Это был её подарок. Она взяла книгу и пошла к окну.";
const xml = (declaration: string) =>
  `${declaration}<FictionBook><description><title-info><book-title>${title}</book-title><author><first-name>Анна</first-name><last-name>Орлова</last-name></author></title-info></description><body><section><p>${body}</p></section></body></FictionBook>`;
function cp1251(value: string): Uint8Array {
  return Uint8Array.from([...value], (char) => {
    const code = char.charCodeAt(0);
    if (code < 128) return code;
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
    const special: Record<string, number> = { Ё: 0xa8, ё: 0xb8, "—": 0x97 };
    if (char in special) return special[char];
    throw new Error(`Unexpected fixture character ${char}`);
  });
}
function utf16(value: string, littleEndian: boolean, bom: boolean): Uint8Array {
  const encoded = Buffer.from(value, "utf16le");
  if (!littleEndian) encoded.swap16();
  return Buffer.concat([
    bom ? Buffer.from(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]) : Buffer.alloc(0),
    encoded,
  ]);
}

class HermesDecoder extends NativeDecoder {
  constructor(label = "utf-8", options?: TextDecoderOptions) {
    if (label !== "utf-8") throw new RangeError("Only UTF-8 is available on Hermes");
    super(label, options);
  }
}

describe("mobile metadata encoding", () => {
  it.each([
    ['<?xml version="1.0" encoding="windows-1251"?>', cp1251],
    ["<?xml version='1.0' encoding='cp1251'?>", cp1251],
    ['<?xml version="1.0" encoding="UTF-16"?>', (text: string) => utf16(text, true, true)],
    ['<?xml version="1.0" encoding="UTF-16BE"?>', (text: string) => utf16(text, false, true)],
    ['<?xml version="1.0" encoding="UTF-16LE"?>', (text: string) => utf16(text, true, false)],
    ['<?xml version="1.0" encoding="UTF-16BE"?>', (text: string) => utf16(text, false, false)],
  ] as const)("decodes metadata and body on UTF8-only Hermes: %s", (declaration, encode) => {
    const source = encode(xml(declaration));
    const original = source.slice();
    try {
      globalThis.TextDecoder = HermesDecoder;
      const metadata = extractFb2Metadata(source);
      expect(metadata.title).toBe(title);
      expect(metadata.author).toBe("Анна Орлова");
      expect(metadata.textSample).toContain(body);
      expect(source).toEqual(original);
    } finally {
      globalThis.TextDecoder = NativeDecoder;
    }
  });

  it("preserves the complete Windows-1251 character table on Hermes", () => {
    const highBytes = Uint8Array.from({ length: 128 }, (_, index) => 128 + index);
    const expected = new NativeDecoder("windows-1251")
      .decode(highBytes)
      .replace(/\s+/g, " ")
      .trim();
    const source = Uint8Array.from([
      ...new TextEncoder().encode(
        '<?xml version="1.0" encoding="windows-1251"?><FictionBook><description><title-info><book-title>',
      ),
      ...highBytes,
      ...new TextEncoder().encode(
        "</book-title></title-info></description><body><section><p>Body</p></section></body></FictionBook>",
      ),
    ]);
    try {
      globalThis.TextDecoder = HermesDecoder;
      expect(extractFb2Metadata(source).title).toBe(expected);
    } finally {
      globalThis.TextDecoder = NativeDecoder;
    }
  });
});

function parseReaderXml(bytes: Uint8Array) {
  const sourceText = readFileSync(
    new URL("../../../../foliate-js/fb2.js", import.meta.url),
    "utf8",
  );
  const source = ts.createSourceFile(
    "fb2.js",
    sourceText,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const declaration = source.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((item) => item.name.getText(source) === "parseXML"),
  );
  if (!declaration) throw new Error("Missing FB2 parser");
  const context = vm.createContext({
    TextDecoder: NativeDecoder,
    Uint8Array,
    DOMParser,
    MIME: { XML: "application/xml" },
  });
  vm.runInContext(`${declaration.getText(source)}; globalThis.parseXml = parseXML;`, context);
  return context.parseXml(new Blob([new Uint8Array(bytes)]));
}

describe("actual FB2 reader XML decoding", () => {
  it.each([
    ['<?xml version="1.0" encoding="windows-1251"?>', cp1251],
    ["<?xml version='1.0' encoding='windows-1251'?>", cp1251],
    ['<?xml version="1.0" encoding="UTF-16"?>', (text: string) => utf16(text, true, true)],
    ['<?xml version="1.0" encoding="UTF-16BE"?>', (text: string) => utf16(text, false, true)],
    ['<?xml version="1.0" encoding="UTF-16LE"?>', (text: string) => utf16(text, true, false)],
  ] as const)("opens the body without corrupting characters: %s", async (declaration, encode) => {
    const doc = await parseReaderXml(encode(xml(declaration)));
    expect(doc.getElementsByTagName("book-title")[0]?.textContent).toBe(title);
    expect(doc.getElementsByTagName("p")[0]?.textContent).toBe(body);
  });
});

describe("mobile TXT preprocessing into the actual EPUB converter", () => {
  it.each([
    ["windows-1251", cp1251],
    ["utf-16le", (text: string) => utf16(text, true, true)],
    ["utf-16be", (text: string) => utf16(text, false, true)],
  ] as const)("preserves chapter prose for %s", async (_encoding, encode) => {
    try {
      globalThis.TextDecoder = HermesDecoder;
      const normalized = ensureTxtUtf8Bytes(encode(`${title}\n\n${body}`), NativeDecoder);
      const result = await new TxtToEpubConverter().convertToBytes({
        file: new File([new Uint8Array(normalized)], "Book.txt"),
      });
      const metadata = await extractEpubMetadata(result.epubBytes);
      expect(metadata.textSample).toContain(body);
      expect(metadata.textSample).not.toContain("�");
    } finally {
      globalThis.TextDecoder = NativeDecoder;
    }
  });
});
