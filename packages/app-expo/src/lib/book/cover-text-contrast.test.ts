import { describe, expect, it } from "vitest";
import { generatedCoverBackgroundColor, generatedCoverTextTone } from "./cover-text-contrast";

describe("generated cover text contrast", () => {
  it("uses light text on dark generated backgrounds", () => {
    expect(generatedCoverTextTone({ title: "Книга 0" })).toBe("light");
  });

  it("keeps the background and text tone stable for the same book", () => {
    const book = { title: "Неизвестная книга", author: "Unknown author" };

    expect(generatedCoverBackgroundColor(book)).toBe(generatedCoverBackgroundColor(book));
    expect(generatedCoverTextTone(book)).toBe(generatedCoverTextTone(book));
  });
});
