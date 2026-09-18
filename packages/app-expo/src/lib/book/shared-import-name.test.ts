import { describe, expect, it } from "vitest";
import { resolveSharedBookName } from "./shared-import-name";

describe("resolveSharedBookName", () => {
  it("keeps the real filename when the share carries one", () => {
    expect(resolveSharedBookName("file:///var/Inbox/Alice%20in%20Wonderland.pdf", "")).toBe(
      "Alice in Wonderland.pdf",
    );
  });

  it("falls back to the signature for nameless content URIs", () => {
    expect(resolveSharedBookName("content://downloads/document/42", "JVBERi0xLjQ")).toBe(
      "book.pdf",
    );
    expect(resolveSharedBookName("content://downloads/document/42", "UEsDBBQA")).toBe("book.epub");
    expect(resolveSharedBookName("content://downloads/document/42", "0JPQu9Cw")).toBe("book.txt");
  });

  it("ignores extensions the importer does not support", () => {
    expect(resolveSharedBookName("content://downloads/photo.jpg", "JVBERi0xLjQ")).toBe("book.pdf");
  });
});
