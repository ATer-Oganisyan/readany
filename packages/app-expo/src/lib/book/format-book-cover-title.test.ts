import { describe, expect, it } from "vitest";
import { formatBookCoverIdentity, formatBookCoverTitle } from "./format-book-cover-title";

describe("formatBookCoverTitle", () => {
  it.each(["а", "в", "и", "к", "о", "с", "у", "до", "из", "на", "of", "to"])(
    "binds the short word '%s' to the following word",
    (shortWord) => {
      expect(formatBookCoverTitle(`${shortWord} море`)).toBe(`${shortWord}\u00A0море`);
    },
  );

  it("binds consecutive one-letter words", () => {
    expect(formatBookCoverTitle("и в мире")).toBe("и\u00A0в\u00A0мире");
  });

  it("binds short words in non-Russian titles", () => {
    expect(formatBookCoverTitle("Machines of Loving Grace")).toBe("Machines of\u00A0Loving Grace");
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

  it("formats generated cover text as title followed by author", () => {
    expect(formatBookCoverIdentity("  Война   и мир ", "  Лев\nТолстой ")).toEqual({
      title: "Война и\u00A0мир",
      author: "Лев Толстой",
      text: "Война и\u00A0мир\nЛев Толстой",
    });
  });
});
