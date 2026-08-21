import { describe, expect, it } from "vitest";
import {
  generatedCoverBackgroundColor,
  generatedCoverPlaceholderColor,
  generatedCoverTextTone,
} from "./cover-text-contrast";

describe("generated cover text contrast", () => {
  it("uses light text on dark generated backgrounds", () => {
    expect(generatedCoverTextTone({ title: "Книга 0" })).toBe("light");
  });

  it("keeps the background and text tone stable for the same book", () => {
    const book = { title: "Неизвестная книга", author: "Unknown author" };

    expect(generatedCoverBackgroundColor(book)).toBe("deep cobalt blue");
    expect(generatedCoverTextTone(book)).toBe("light");
  });

  it("uses stable, varied non-white placeholders for catalog books", () => {
    const placeholders = new Set(
      Array.from({ length: 64 }, (_, index) =>
        generatedCoverPlaceholderColor({ title: `Книга ${index}`, author: `Автор ${index}` }),
      ),
    );

    expect(placeholders.size).toBeGreaterThan(1);
    for (const color of placeholders) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/u);
      expect(color).not.toBe("#FFFFFF");
    }
  });

  it("uses the backend-provided identity as its stable color seed", () => {
    const displayIdentity = { title: "Маскарад", author: "Михаил Лермонтов" };
    expect(generatedCoverPlaceholderColor(displayIdentity)).toBe(
      generatedCoverPlaceholderColor(displayIdentity),
    );
  });
});
