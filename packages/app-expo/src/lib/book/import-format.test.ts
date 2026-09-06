import { describe, expect, it } from "vitest";
import { bookImportFormat } from "./import-format";

describe("actual reader-compatible format selection", () => {
  it("opens compound FB2 ZIP files through the archive reader", () => {
    expect(bookImportFormat("Книга.FB2.ZIP")).toBe("fbz");
  });
  it("rejects RAR comics instead of registering an unreadable CBZ book", () => {
    expect(() => bookImportFormat("comic.cbr")).toThrow(/не поддерживается/);
  });
  it("does not accept arbitrary ZIP files", () => {
    expect(() => bookImportFormat("archive.zip")).toThrow(/не поддерживается/);
  });
});
