import { describe, expect, it } from "vitest";
import { getBookImportFormat, getBookImportName } from "./book-import-format";

describe("book import filenames", () => {
  it.each(["epub", "pdf", "fb2", "fbz", "txt", "umd", "mobi", "azw", "azw3", "cbz"])(
    "recognizes %s independent of case",
    (format) => {
      expect(getBookImportFormat(`Книга.${format.toUpperCase()}`)).toBe(format);
    },
  );
  it("keeps zipped FB2 readable after copying it to managed storage", () => {
    expect(getBookImportFormat("Книга.FB2.ZIP")).toBe("fbz");
  });
  it.each(["book", "book.zip", "book.exe", "book.cbr", "", "epub"])(
    "rejects unsupported input %s instead of pretending it is EPUB",
    (name) => {
      expect(() => getBookImportFormat(name)).toThrow("Unsupported book format");
    },
  );
  it("preserves literal picker names, including percent escape sequences", () => {
    expect(getBookImportName("file:///cache/a", "100% книга.txt")).toBe("100% книга.txt");
    expect(getBookImportName("file:///cache/a", "%20.epub")).toBe("%20.epub");
    expect(getBookImportName("C:\\books\\100%.txt")).toBe("100%.txt");
    expect(getBookImportName("/books/%20.epub")).toBe("%20.epub");
  });
  it("decodes URI names once and tolerates a malformed percent sign", () => {
    expect(getBookImportName("file:///books/%D0%9A%D0%BD%D0%B8%D0%B3%D0%B0.txt")).toBe("Книга.txt");
    expect(getBookImportName("content://books/100%.txt")).toBe("100%.txt");
    expect(getBookImportName("file:///books/%2520.txt")).toBe("%20.txt");
  });
});
