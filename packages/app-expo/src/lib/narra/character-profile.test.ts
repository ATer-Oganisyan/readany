import { describe, expect, it } from "vitest";
import { characterBiography, characterProfileText } from "./character-profile";
import type { NarraCharacter } from "./types";

const character = {
  profileDetails: [
    { key: "description", value: "  Полное описание героя.  " },
    { key: "facts", value: [" Первый факт ", "", "Второй факт"] },
  ],
} as NarraCharacter;

describe("characterProfileText", () => {
  it("returns a trimmed string profile field", () => {
    expect(characterProfileText(character, "description")).toBe("Полное описание героя.");
  });

  it("joins array profile fields and ignores empty items", () => {
    expect(characterProfileText(character, "facts")).toBe("Первый факт Второй факт");
  });

  it("returns undefined for an absent field", () => {
    expect(characterProfileText(character, "missing")).toBeUndefined();
  });
});

describe("characterBiography", () => {
  it("keeps role as a fallback for a persisted legacy character", () => {
    expect(
      characterBiography({
        role: "  Главный герой  ",
        description: undefined,
        profileDetails: [],
      } as unknown as NarraCharacter),
    ).toBe("Главный герой");
  });
});
