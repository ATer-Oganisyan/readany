import { describe, expect, it } from "vitest";
import {
  formatBookCoverAuthor,
  formatBookCoverIdentity,
  formatBookCoverTitle,
} from "./format-book-cover-title";

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

  it("preserves the complete backend-provided display title", () => {
    expect(
      formatBookCoverTitle("Эмоциональный интеллект. Почему он может значить больше, чем IQ"),
    ).toBe("Эмоциональный интеллект. Почему он\u00A0может значить больше, чем IQ");
    expect(formatBookCoverTitle("Кто виноват? Что делать?")).toBe("Кто виноват? Что делать?");
    expect(formatBookCoverTitle("Сначала главное! Потом детали")).toBe(
      "Сначала главное! Потом детали",
    );
  });

  it("preserves punctuation when the title contains only one sentence", () => {
    expect(formatBookCoverTitle("Название.")).toBe("Название.");
    expect(formatBookCoverTitle("Что делать?")).toBe("Что делать?");
  });

  it("applies non-breaking spaces without changing title semantics", () => {
    expect(formatBookCoverTitle("Любовь и море. Вторая часть")).toBe(
      "Любовь и\u00A0море. Вторая часть",
    );
  });

  it("formats generated cover text as title followed by author", () => {
    expect(formatBookCoverIdentity("  Война   и мир ", "  Лев\nТолстой ")).toEqual({
      title: "Война и\u00A0мир",
      author: "Лев Толстой",
      text: "Война и\u00A0мир\nЛев Толстой",
    });
  });

  it("does not normalize bibliographic metadata on the client", () => {
    expect(formatBookCoverTitle("Маскарад[1]")).toBe("Маскарад[1]");
    expect(formatBookCoverTitle("Мертвое озеро (Часть первая)")).toBe(
      "Мертвое озеро (Часть первая)",
    );
  });

  it.each([
    ["Что делать?", "Что делать?"],
    ["Хорошо!", "Хорошо!"],
    ["Росла́влев, или Русские в 1812 году", "Росла́влев, или Русские в\u00A01812 году"],
  ])("preserves the meaningful title %s", (title, expected) => {
    expect(formatBookCoverTitle(title)).toBe(expected);
  });

  it("does not normalize author metadata on the client", () => {
    expect(formatBookCoverAuthor("Николай Некрасов (1821—1877)")).toBe(
      "Николай Некрасов (1821—1877)",
    );
  });
});
