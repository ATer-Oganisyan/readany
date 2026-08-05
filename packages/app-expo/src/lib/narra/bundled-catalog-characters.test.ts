import { describe, expect, it } from "vitest";
import { BUNDLED_CATALOG_BOOK_DEFINITIONS } from "../catalog/bundled-book-definitions";
import {
  getBundledCatalogCharactersById,
  getBundledCatalogCharactersByTitle,
} from "./bundled-catalog-characters";

describe("bundled catalog characters", () => {
  it("ships a valid character set for every catalog book", () => {
    expect(BUNDLED_CATALOG_BOOK_DEFINITIONS).toHaveLength(17);

    for (const book of BUNDLED_CATALOG_BOOK_DEFINITIONS) {
      const characters = getBundledCatalogCharactersById(book.id);
      expect(characters, book.title).toBeDefined();
      expect(characters?.length, book.title).toBeGreaterThanOrEqual(2);
      expect(characters?.length, book.title).toBeLessThanOrEqual(8);
      expect(new Set(characters?.map((character) => character.id)).size, book.title).toBe(
        characters?.length,
      );
      expect(
        characters?.every(
          (character) =>
            character.name.trim() &&
            character.fullName.trim() &&
            character.role.trim() &&
            character.appearancePrompt.trim() &&
            character.unlockProgress === 0,
        ),
        book.title,
      ).toBe(true);
    }
  });

  it("matches catalog titles with the same normalization as bundled books", () => {
    const characters = getBundledCatalogCharactersByTitle("  АННА   КАРЕНИНА ");

    expect(characters?.map((character) => character.id)).toEqual([
      "anna-karenina",
      "alexey-vronsky",
      "alexey-karenin",
      "konstantin-levin",
      "kitty-shcherbatskaya",
      "stiva-oblonsky",
    ]);
  });

  it("returns fresh data so persisted portrait updates cannot mutate the bundle", () => {
    const first = getBundledCatalogCharactersById("anna-karenina");
    const second = getBundledCatalogCharactersById("anna-karenina");

    expect(first).not.toBe(second);
    expect(first?.[0]).not.toBe(second?.[0]);
    first?.[0]?.traits.push("изменено");
    expect(second?.[0]?.traits).not.toContain("изменено");
  });
});
