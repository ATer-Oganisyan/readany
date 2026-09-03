import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { isLikelyWindows1251 } from "./windows-1251";
import { TxtToEpubConverter } from "./txt-to-epub";

const russianTxt = "Мастер и Маргарита\nМихаил Булгаков\n\nГлава 1\n" +
  "Он вошёл в комнату и увидел, что на столе лежит книга. Это был её подарок.\n\n" +
  "Глава 2\nОна взяла книгу и пошла к окну, но он остался у двери.";

function encodeWindows1251(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([...text].map((char) => {
    const code = char.codePointAt(0)!;
    if (code < 128) return code;
    if (code >= 0x0410 && code <= 0x044f) return code - 0x0410 + 0xc0;
    if (char === "Ё") return 0xa8;
    if (char === "ё") return 0xb8;
    throw new Error("Unsupported test character");
  }));
}

describe("Windows-1251 Russian prose detection", () => {
  it("recognizes Cyrillic prose including ё", () => {
    expect(isLikelyWindows1251(encodeWindows1251(russianTxt))).toBe(true);
  });
  it("samples beyond a long ASCII preamble", () => {
    const bytes = encodeWindows1251("License notice. ".repeat(2500) + russianTxt.repeat(250));
    expect(isLikelyWindows1251(bytes)).toBe(true);
  });
  it("does not treat Unicode or ambiguous legacy bytes as Russian", () => {
    for (const bytes of [
      new TextEncoder().encode(russianTxt),
      new TextEncoder().encode("第一章 中文书籍"),
      new TextEncoder().encode("An English book."),
      Uint8Array.from([0xff, 0xfe, 0x10, 0x04]),
      Uint8Array.from([0xef, 0xbb, 0xbf, ...encodeWindows1251(russianTxt)]),
      Uint8Array.from(Buffer.from("d5e2cac7d2bbb1bed6d0cec4d0a1cbb5a3acced2c3c7d4dab6c1cae9a3ac", "hex")),
      new Uint8Array(100).fill(0xff),
      encodeWindows1251("АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"),
    ]) expect(isLikelyWindows1251(bytes)).toBe(false);
  });
});

describe("TXT to EPUB legacy encoding", () => {
  it("converts Windows-1251 to readable UTF-8 EPUB with Russian language", async () => {
    const file = new File([encodeWindows1251(russianTxt)], "Мастер.txt");
    const result = await new TxtToEpubConverter().convertToBytes({ file });
    const epub = new TextDecoder().decode(result.epubBytes);
    expect(epub).toContain("Он вошёл в комнату");
    expect(epub).toContain("Мастер и Маргарита");
    expect(epub).not.toContain("锑耱屦");
    expect(result.language).toBe("ru");
  });
  it("uses Windows-1251 on the streaming path too", async () => {
    // Exercise the same detector used for files above 8 MiB without a huge fixture.
    const converter = new TxtToEpubConverter() as unknown as {
      detectEncodingFromFile(file: File): Promise<string>;
    };
    expect(await converter.detectEncodingFromFile(new File([encodeWindows1251(russianTxt)], "book.txt")))
      .toBe("windows-1251");
  });
  it("keeps legacy GBK Chinese content", async () => {
    const bytes = Buffer.from("d5e2cac7d2bbb1bed6d0cec4d0a1cbb5a3acced2c3c7d4dab6c1cae9a3ac", "hex");
    const result = await new TxtToEpubConverter().convertToBytes({ file: new File([bytes], "book.txt") });
    expect(new TextDecoder().decode(result.epubBytes)).toContain(new TextDecoder("gbk").decode(bytes));
    expect(result.language).toBe("zh");
  });
  it("keeps UTF-8 Russian and Chinese content", async () => {
    for (const [text, language] of [[russianTxt, "ru"], ["第一章\n这是一本中文小说。", "zh"]]) {
      const result = await new TxtToEpubConverter().convertToBytes({ file: new File([text!], "book.txt") });
      expect(new TextDecoder().decode(result.epubBytes)).toContain(text!.split("\n")[0]);
      expect(result.language).toBe(language);
    }
  });
});
