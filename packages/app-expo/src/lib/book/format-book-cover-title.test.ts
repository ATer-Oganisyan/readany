import { describe, expect, it } from "vitest";
import { formatBookCoverTitle } from "./format-book-cover-title";

describe("formatBookCoverTitle", () => {
  it.each(["а", "в", "и", "к", "о", "с", "у"])(
    "binds '%s' to the following word",
    (serviceWord) => {
      expect(formatBookCoverTitle(`${serviceWord} море`)).toBe(`${serviceWord}\u00A0море`);
    },
  );

  it("binds consecutive one-letter words", () => {
    expect(formatBookCoverTitle("и в мире")).toBe("и\u00A0в\u00A0мире");
  });

  it("preserves ordinary spaces between regular words", () => {
    expect(formatBookCoverTitle("Война и мир")).toBe("Война и\u00A0мир");
  });

  it("does not add joiners inside regular words", () => {
    expect(formatBookCoverTitle("Эмоциональный интеллект")).toBe("Эмоциональный интеллект");
  });

  it("keeps only the first sentence without trailing punctuation", () => {
    expect(
      formatBookCoverTitle("Эмоциональный интеллект. Почему он может значить больше, чем IQ"),
    ).toBe("Эмоциональный интеллект");
    expect(formatBookCoverTitle("Кто виноват? Что делать?")).toBe("Кто виноват");
    expect(formatBookCoverTitle("Сначала главное! Потом детали")).toBe("Сначала главное");
  });

  it("preserves punctuation when the title contains only one sentence", () => {
    expect(formatBookCoverTitle("Название.")).toBe("Название.");
    expect(formatBookCoverTitle("Что делать?")).toBe("Что делать?");
  });

  it("applies non-breaking spaces after shortening the title", () => {
    expect(formatBookCoverTitle("Любовь и море. Вторая часть")).toBe("Любовь и\u00A0море");
  });
});
