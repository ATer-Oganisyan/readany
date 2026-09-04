import { expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { ensureTxtUtf8Bytes } from "./txt-encoding";

const text = "Он вошёл в комнату и увидел, что на столе лежит книга. " +
  "Это был её подарок. Она взяла книгу и пошла к окну.";
const windows1251 = Uint8Array.from([...text].map((char) =>
  char === "ё" ? 0xb8 : char.charCodeAt(0) >= 0x0410 ? char.charCodeAt(0) - 0x0410 + 0xc0 : char.charCodeAt(0)));

it("converts Windows-1251 before the mobile EPUB converter sees the bytes", () => {
  const before = windows1251.slice();
  expect(new TextDecoder().decode(ensureTxtUtf8Bytes(windows1251, TextDecoder))).toBe(text);
  expect(windows1251).toEqual(before);
});

it("uses the supplied legacy decoder when Hermes only supports UTF-8", () => {
  const Native = globalThis.TextDecoder;
  const encodings: string[] = [];
  class LegacyDecoder extends Native {
    constructor(label?: string, options?: TextDecoderOptions) {
      super(label, options);
      encodings.push(label ?? "utf-8");
    }
  }
  class HermesDecoder extends Native {
    constructor(label?: string, options?: TextDecoderOptions) {
      if (label && label !== "utf-8") throw new RangeError("Unsupported encoding");
      super(label, options);
    }
  }
  try {
    globalThis.TextDecoder = HermesDecoder;
    expect(new Native().decode(ensureTxtUtf8Bytes(windows1251, LegacyDecoder))).toBe(text);
    expect(encodings).toContain("windows-1251");
  } finally {
    globalThis.TextDecoder = Native;
  }
});

it("leaves UTF-8 including CJK unchanged", () => {
  for (const value of [text, "第一章 中文书籍", "日本語の本", "English text"]) {
    const bytes = new TextEncoder().encode(value);
    expect(ensureTxtUtf8Bytes(bytes, TextDecoder)).toBe(bytes);
  }
});

it("preserves Chinese GBK and Japanese Shift-JIS decoding", () => {
  for (const [hex, encoding] of [
    ["d5e2cac7d2bbb1bed6d0cec4d0a1cbb5a3acced2c3c7d4dab6c1cae9a3ac", "gb18030"],
    ["82b182ea82cd93fa967b8cea82cc967b82c582b78142", "shift_jis"],
  ]) {
    const bytes = Uint8Array.from(Buffer.from(hex!, "hex"));
    expect(new TextDecoder().decode(ensureTxtUtf8Bytes(bytes, TextDecoder)))
      .toBe(new TextDecoder(encoding).decode(bytes));
  }
});

it("preserves UTF-16 BOM handling", () => {
  const le = Buffer.from(text, "utf16le");
  for (const bytes of [
    Buffer.concat([Buffer.from([0xff, 0xfe]), le]),
    Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(le).swap16()]),
  ]) expect(new TextDecoder().decode(ensureTxtUtf8Bytes(bytes, TextDecoder))).toBe(text);
});

it("does not misdetect UTF-8 split at sampling boundaries", () => {
  const bytes = new TextEncoder().encode("X" + text.repeat(2000));
  expect(ensureTxtUtf8Bytes(bytes, TextDecoder)).toBe(bytes);
});
