import { describe, expect, it } from "vitest";
import {
  CURRENT_PORTRAIT_PROMPT_VERSION,
  migrateGeneratedFemalePortraits,
} from "./portrait-prompt-migration";
import type { NarraBookState, NarraCharacter } from "./types";

function character(overrides: Partial<NarraCharacter>): NarraCharacter {
  return {
    id: "character",
    name: "Героиня",
    fullName: "Героиня",
    role: "роль",
    gender: "female",
    voice: "voice",
    traits: [],
    speechStyle: "",
    speechExamples: [],
    appearancePrompt: "",
    passport: {
      age: 25,
      gender: "female",
      build: "",
      hair: "",
      eyes: "",
      face: "",
      outfit: "",
    },
    unlockProgress: 0,
    ...overrides,
  };
}

function book(characters: NarraCharacter[]): NarraBookState {
  return {
    bookId: "book",
    characters,
    memories: {},
    chats: {},
    scenes: {},
    sceneAudios: {},
    summaries: {},
  };
}

describe("portrait prompt migration", () => {
  it("does not depend on Object.fromEntries in Hermes", () => {
    const originalFromEntries = Object.fromEntries;
    Object.fromEntries = undefined as never;
    try {
      const migrated = migrateGeneratedFemalePortraits({
        books: { book: book([character({ portraitUri: "file:///old.jpg" })]) },
      });
      expect(migrated.books.book?.characters[0]?.portraitUri).toBeUndefined();
    } finally {
      Object.fromEntries = originalFromEntries;
    }
  });

  it("resets old generated adult female portraits only once", () => {
    const generated = character({ portraitUri: "file:///old.jpg" });
    const male = character({ id: "male", gender: "male", portraitUri: "file:///male.jpg" });
    const minorPassport = character({}).passport;
    if (!minorPassport) throw new Error("passport fixture is required");
    const minor = character({
      id: "minor",
      passport: { ...minorPassport, age: 17 },
      portraitUri: "file:///minor.jpg",
    });
    const state = { books: { book: book([generated, male, minor]) } };

    const migrated = migrateGeneratedFemalePortraits(state);

    expect(migrated.portraitPromptVersion).toBe(CURRENT_PORTRAIT_PROMPT_VERSION);
    expect(migrated.books.book?.characters[0]?.portraitUri).toBeUndefined();
    expect(migrated.books.book?.characters[1]?.portraitUri).toBe("file:///male.jpg");
    expect(migrated.books.book?.characters[2]?.portraitUri).toBe("file:///minor.jpg");
    expect(migrateGeneratedFemalePortraits(migrated)).toBe(migrated);
  });

  it("keeps bundled catalog assets while removing an old generated override", () => {
    const state = {
      books: {
        book: book([
          character({
            portraitAssetId: "book/character",
            portraitUri: "file:///override.jpg",
            portraitUriOverridesAsset: true,
          }),
        ]),
      },
    };

    const migrated = migrateGeneratedFemalePortraits(state);
    const migratedCharacter = migrated.books.book?.characters[0];

    expect(migratedCharacter?.portraitAssetId).toBe("book/character");
    expect(migratedCharacter?.portraitUri).toBeUndefined();
    expect(migratedCharacter?.portraitUriOverridesAsset).toBe(false);
  });
});
