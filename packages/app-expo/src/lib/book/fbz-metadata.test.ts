import { buildStoreOnlyZip, crc32 } from "@readany/core/utils/store-only-zip";
import pako from "pako";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractBookMetadata,
  extractBookMetadataFromFile,
  extractFbzSourceBytes,
} from "./metadata-extractor";

const utf8 = (text: string) => new TextEncoder().encode(text);
const title = "Архив — Письмо у реки";
const xml = (encoding = "UTF-8") => `<?xml version="1.0" encoding="${encoding}"?>
<FictionBook><description><title-info><book-title>${title}</book-title>
<author><first-name>Анна</first-name><last-name>Орлова</last-name></author>
<lang>ru</lang><annotation><p>История письма.</p></annotation></title-info></description>
<body><section><p>Анна читает письмо у реки.</p></section></body></FictionBook>`;

function cp1251(text: string) {
  return Uint8Array.from([...text], (character) => {
    const code = character.charCodeAt(0);
    if (code < 128) return code;
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
    if (character === "—") return 0x97;
    throw new Error(`Unsupported test character: ${character}`);
  });
}

// Real, CRC-valid deflated ZIP fixture, not a mocked ZIP/metadata parser.
function deflatedZip(name: string, data: Uint8Array, declaredSize = data.length) {
  const bytes = buildStoreOnlyZip([{ name, data: pako.deflateRaw(data) }]);
  const view = new DataView(bytes.buffer);
  const central = view.getUint32(bytes.length - 22 + 16, true);
  view.setUint16(8, 8, true);
  view.setUint16(central + 10, 8, true);
  view.setUint32(14, crc32(data), true);
  view.setUint32(central + 16, crc32(data), true);
  view.setUint32(22, declaredSize, true);
  view.setUint32(central + 24, declaredSize, true);
  return bytes;
}

function trackedFile(bytes: Uint8Array) {
  const blob = new Blob([new Uint8Array(bytes)]);
  return { size: blob.size, slice: vi.fn((start = 0, end = blob.size) => blob.slice(start, end)) };
}

afterEach(() => vi.restoreAllMocks());

describe("FB2 archive metadata on the actual import entry points", () => {
  it.each(["utf8", "cp1251"])(
    "returns exact validated %s XML bytes for analysis, without transcoding",
    async (encoding) => {
      const bytes = encoding === "cp1251" ? cp1251(xml("windows-1251")) : utf8(xml());
      expect(
        await extractFbzSourceBytes(trackedFile(deflatedZip("nested/BOOK.FB2", bytes))),
      ).toEqual(bytes);
    },
  );
  it("rejects an oversized expanded source before materializing it for analysis", async () => {
    await expect(
      extractFbzSourceBytes(trackedFile(deflatedZip("book.fb2", utf8(xml()), 51 * 1024 * 1024))),
    ).rejects.toThrow(/50/);
  });
  it.each(["bytes", "file"] as const)(
    "extracts a deflated nested FB2 title/author through %s",
    async (source) => {
      const bytes = deflatedZip("nested/books/BOOK.FB2", utf8(xml()));
      const metadata =
        source === "bytes"
          ? await extractBookMetadata(bytes, "fbz", "09-nested.fb2.zip")
          : await extractBookMetadataFromFile(trackedFile(bytes), "fbz", "09-nested.fb2.zip");
      expect(metadata).toMatchObject({ title, author: "Анна Орлова", language: "ru" });
      expect(metadata.textSample).toContain("Анна читает письмо у реки.");
    },
  );

  it.each(["bytes", "file"] as const)(
    "decodes archived Windows-1251 XML on UTF8-only Hermes through %s",
    async (source) => {
      const NativeDecoder = globalThis.TextDecoder;
      class HermesDecoder extends NativeDecoder {
        constructor(label = "utf-8", options?: TextDecoderOptions) {
          if (label !== "utf-8") throw new RangeError("Only UTF8 on Hermes");
          super(label, options);
        }
      }
      const bytes = deflatedZip("book.fb2", cp1251(xml("windows-1251")));
      try {
        globalThis.TextDecoder = HermesDecoder;
        const metadata =
          source === "bytes"
            ? await extractBookMetadata(bytes, "fbz", "08-archive.fbz")
            : await extractBookMetadataFromFile(trackedFile(bytes), "fbz", "08-archive.fbz");
        expect(metadata.title).toBe(title);
        expect(metadata.author).toBe("Анна Орлова");
      } finally {
        globalThis.TextDecoder = NativeDecoder;
      }
    },
  );

  it("reads only the chosen FB2 entry, never an unrelated large archive member", async () => {
    const bytes = buildStoreOnlyZip([
      { name: "unused/large.bin", data: new Uint8Array(4 * 1024 * 1024) },
      { name: "nested/story.fb2", data: utf8(xml()) },
    ]);
    const file = trackedFile(bytes);
    expect((await extractBookMetadataFromFile(file, "fbz", "collection.fbz")).title).toBe(title);
    expect(file.slice.mock.calls.every(([start, end]) => end - start <= 65_557)).toBe(true);
  });

  it.each(["bytes", "file"] as const)(
    "falls back for malformed/missing/oversized FB2 metadata through %s",
    async (source) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const damaged = deflatedZip("book.fb2", utf8(xml()));
      const damagedHeader = new DataView(damaged.buffer);
      const dataStart = 30 + damagedHeader.getUint16(26, true);
      damaged.fill(0xff, dataStart, dataStart + damagedHeader.getUint32(18, true));
      const fixtures = [
        utf8("not an archive"),
        damaged,
        buildStoreOnlyZip([{ name: "readme.txt", data: utf8("no book") }]),
        buildStoreOnlyZip([{ name: "book.fb2", data: new Uint8Array(2 * 1024 * 1024 + 1) }]),
      ];
      for (const bytes of fixtures) {
        const metadata =
          source === "bytes"
            ? await extractBookMetadata(bytes, "fbz", "broken.fb2.zip")
            : await extractBookMetadataFromFile(trackedFile(bytes), "fbz", "broken.fb2.zip");
        expect(metadata).toMatchObject({ title: "broken", author: "", coverBytes: null });
      }
    },
  );

  it.each(["bytes", "file"] as const)(
    "rejects forged small ZIP sizes without whole-output inflate through %s",
    async (source) => {
      const bytes = deflatedZip("book.fb2", utf8(`${xml()}${"x".repeat(3 * 1024 * 1024)}`), 1024);
      const wholeInflate = vi.spyOn(pako, "inflateRaw");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const metadata =
        source === "bytes"
          ? await extractBookMetadata(bytes, "fbz", "oversized.fbz")
          : await extractBookMetadataFromFile(trackedFile(bytes), "fbz", "oversized.fbz");
      expect(metadata.title).toBe("oversized");
      expect(wholeInflate).not.toHaveBeenCalled();
    },
  );

  it("rejects an oversized central directory before requesting that range from disk", async () => {
    const size = 10 * 1024 * 1024;
    const tail = new Uint8Array(65_557);
    const view = new DataView(tail.buffer);
    const eocd = tail.length - 22;
    view.setUint32(eocd, 0x06054b50, true);
    view.setUint16(eocd + 10, 1, true);
    view.setUint32(eocd + 12, 8 * 1024 * 1024, true);
    view.setUint32(eocd + 16, 0, true);
    const slice = vi.fn((start: number, end: number) => ({
      arrayBuffer: async () =>
        start === size - tail.length && end === size ? tail.buffer : new ArrayBuffer(0),
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const metadata = await extractBookMetadataFromFile({ size, slice }, "fbz", "large.fbz");
    expect(metadata.title).toBe("large");
    expect(slice.mock.calls.every(([start, end]) => end - start <= 65_557)).toBe(true);
  });
});
