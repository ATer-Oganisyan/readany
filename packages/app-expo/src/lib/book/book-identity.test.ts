import { describe, expect, it } from "vitest";
import { bookIdentity } from "./book-identity";

describe("book identity", () => {
  it("matches Russian casing, ё and whitespace in legacy copies", () => {
    expect(bookIdentity("  ПРЕСТУПЛЕНИЕ\nИ НАКАЗАНИЕ ", "ФЁДОР  ДОСТОЕВСКИЙ")).toBe(
      bookIdentity("Преступление и наказание", "Федор Достоевский"),
    );
  });

  it.each(["Война и мир", "ЁЖ", "İSTANBUL", "IĞDIR", "ΟΣ", "CAFÉ", "ẞ", "中文", "日本語"])(
    "preserves the previous Russian-locale key for %s",
    (title) => {
      const previous = title
        .trim()
        .toLocaleLowerCase("ru-RU")
        .replace(/ё/g, "е")
        .replace(/\s+/g, " ");
      expect(bookIdentity(title, "Автор")).toBe(`${previous}|автор`);
    },
  );
});
