import { DOMParser } from "@xmldom/xmldom";
import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { TxtToEpubConverter } from "./txt-to-epub";

async function convert(bytes: Uint8Array, mode: "bytes" | "file" = "bytes") {
  const converter = new TxtToEpubConverter();
  const file = new File([Uint8Array.from(bytes)], "100% & книга.txt");
  const result =
    mode === "bytes"
      ? await converter.convertToBytes({ file, language: "en" })
      : {
          epubBytes: new Uint8Array(
            await (await converter.convert({ file, language: "en" })).file.arrayBuffer(),
          ),
        };
  const reader = new ZipReader(new Uint8ArrayReader(result.epubBytes), { useWebWorkers: false });
  try {
    const entries = await reader.getEntries();
    return Object.fromEntries(
      await Promise.all(
        entries.map(
          async (entry) =>
            [entry.filename, (await entry.getData?.(new TextWriter())) ?? ""] as const,
        ),
      ),
    );
  } finally {
    await reader.close();
  }
}

describe("TXT import produces readable EPUB", () => {
  it.each(["bytes", "file"] as const)("escapes chapter headings in the %s path", async (mode) => {
    const title = "Chapter 1: Tom & Jerry <friends>";
    const entries = await convert(
      new TextEncoder().encode(`${title}\nA story.\n\nChapter 2: Home\nThe end.`),
      mode,
    );
    const errors: string[] = [];
    const parser = new DOMParser({
      errorHandler: {
        warning: (e) => errors.push(e),
        error: (e) => errors.push(e),
        fatalError: (e) => errors.push(e),
      },
    });
    for (const [name, value] of Object.entries(entries)) {
      if (/\.(xhtml|opf|ncx|xml)$/.test(name)) parser.parseFromString(value, "application/xml");
    }
    expect(errors).toEqual([]);
    const text = Object.entries(entries)
      .filter(([name]) => name.endsWith(".xhtml"))
      .map(([, value]) => value)
      .join("\n");
    expect(text).toContain("Tom &amp; Jerry &lt;friends&gt;");
    expect(text).not.toContain("Tom & Jerry <friends>");
    expect(text).toContain("A story.");
    expect(text).toContain("The end.");
  });
  it.each(["le", "be"])("honors UTF-16%s BOM before the ASCII UTF-8 heuristic", async (endian) => {
    const text = `Chapter 1\n${"English text and Russian: Привет мир.\n".repeat(50)}`;
    const content = Buffer.from(text, "utf16le");
    const bytes = Buffer.concat([
      Buffer.from(endian === "le" ? [0xff, 0xfe] : [0xfe, 0xff]),
      endian === "le" ? content : content.swap16(),
    ]);
    const entries = await convert(bytes);
    const chapters = Object.entries(entries)
      .filter(([name]) => name.endsWith(".xhtml"))
      .map(([, value]) => value)
      .join("");
    expect(chapters).toContain("Привет мир.");
    expect(chapters).not.toContain("\u0000");
    expect(chapters).not.toContain("\uFFFD");
  });
  it("rejects empty text instead of creating an unreadable book", async () => {
    await expect(convert(new TextEncoder().encode("   \n"))).rejects.toThrow();
  });
});

it("preserves prose mentioning a chapter and streaming input over 8 MiB", async () => {
  const line = "She read Chapter 2 yesterday and kept the complete text.\n";
  const count = Math.ceil((8 * 1024 * 1024) / line.length);
  const entries = await convert(
    new TextEncoder().encode(`Chapter 1\n${line.repeat(count)}\nChapter 2\nFinal sentence.`),
  );
  const content = Object.entries(entries)
    .filter(([name]) => name.endsWith(".xhtml"))
    .map(([, text]) => text)
    .join("");
  expect(content.split(line.trim()).length - 1).toBe(count);
  expect(content).toContain("Final sentence.");
});
