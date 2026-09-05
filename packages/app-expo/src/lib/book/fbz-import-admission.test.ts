import { buildStoreOnlyZip, crc32 } from "@readany/core/utils/store-only-zip";
import pako from "pako";
import { describe, expect, it, vi } from "vitest";
import { validateBookImportSource } from "./metadata-extractor";

const limit = 50 * 1024 * 1024;
const utf8 = (value: string) => new TextEncoder().encode(value);
const xml = (body: string, encoding = "UTF-8") =>
  `<?xml version="1.0" encoding="${encoding}"?><FictionBook><body><section><p>${body}</p></section></body></FictionBook>`;

function archive(data: Uint8Array, claimedSize = data.length) {
  const bytes = buildStoreOnlyZip([{ name: "nested/story.fb2", data: pako.deflateRaw(data) }]);
  const view = new DataView(bytes.buffer);
  const central = view.getUint32(bytes.length - 22 + 16, true);
  view.setUint16(8, 8, true);
  view.setUint16(central + 10, 8, true);
  view.setUint32(14, crc32(data), true);
  view.setUint32(central + 16, crc32(data), true);
  view.setUint32(22, claimedSize, true);
  view.setUint32(central + 24, claimedSize, true);
  return bytes;
}

function trackedFile(bytes: Uint8Array) {
  const blob = new Blob([new Uint8Array(bytes)]);
  return { size: blob.size, slice: vi.fn((start = 0, end = blob.size) => blob.slice(start, end)) };
}

describe("bounded complete FB2 import validation", () => {
  it("rejects a genuinely oversized compressed FB2 before reading its payload", async () => {
    // A valid 50 MiB+ XML compressed into a tiny real ZIP, with truthful sizes
    // and CRC. The old Infinity admission path expands and accepts all of it.
    const bytes = archive(utf8(xml("a".repeat(limit))));
    const file = trackedFile(bytes);
    await expect(validateBookImportSource(file, "fbz")).rejects.toThrow(/50/);
    expect(file.slice.mock.calls.every(([start, end]) => end - start <= 65_557)).toBe(true);
    expect(file.slice).toHaveBeenCalledTimes(2); // tail and central directory only
  }, 20_000);

  it("applies the same limit to raw FB2 before reading XML into memory", async () => {
    const slice = vi.fn(() => ({ arrayBuffer: async () => utf8(xml("Анна reads.")).buffer }));
    await expect(validateBookImportSource({ size: limit + 1, slice }, "fb2")).rejects.toMatchObject(
      { code: "SOURCE_TOO_LARGE" },
    );
    expect(slice).not.toHaveBeenCalled();
  });

  it("rejects forged small ZIP sizes while streaming actual output, not after whole-output inflate", async () => {
    const bytes = archive(utf8(xml("x".repeat(4 * 1024 * 1024))), 1024);
    const wholeInflate = vi.spyOn(pako, "inflateRaw");
    try {
      await expect(validateBookImportSource(trackedFile(bytes), "fbz")).rejects.toThrow(
        /повреждён/,
      );
      expect(wholeInflate).not.toHaveBeenCalled();
    } finally {
      wholeInflate.mockRestore();
    }
  });

  it.each(["UTF-8", "UTF-16", "windows-1251"])(
    "accepts a normal archived %s book with readable multilingual prose",
    async (encoding) => {
      const text = xml(
        encoding === "windows-1251" ? "Анна reads письмо." : "Анна reads письмо. 林读信。",
        encoding,
      );
      const data =
        encoding === "UTF-16"
          ? new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]))
          : encoding === "windows-1251"
            ? Uint8Array.from([...text], (character) => {
                const code = character.charCodeAt(0);
                if (code < 128) return code;
                if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
                throw new Error(`Unexpected fixture character ${character}`);
              })
            : utf8(text);
      await expect(
        validateBookImportSource(trackedFile(archive(data)), "fbz"),
      ).resolves.toBeUndefined();
      await expect(validateBookImportSource(trackedFile(data), "fb2")).resolves.toBeUndefined();
    },
  );
});
