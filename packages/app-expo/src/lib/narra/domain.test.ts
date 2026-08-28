import { describe, expect, it } from "vitest";
import {
  emptyNarraBookState,
  isCharacterUnlocked,
  withNarraCharacterUpdates,
  withNarraCharacters,
  withNarraChatMessage,
  withNarraMemory,
} from "./domain";
import type { NarraCharacter } from "./types";

const character: NarraCharacter = {
  id: "anna",
  name: "Анна",
  fullName: "Анна Каренина",
  role: "Главная героиня",
  gender: "female",
  voice: "Che",
  traits: ["искренняя"],
  speechStyle: "эмоциональная",
  speechExamples: [],
  appearancePrompt: "тёмные волосы",
  unlockProgress: 0.35,
  portraitAssetId: "anna-karenina/anna-karenina",
  portraitUri: "file:///portrait.png",
  portraitUriOverridesAsset: true,
};

function cloneCharacter(value: NarraCharacter): NarraCharacter {
  return {
    ...value,
    traits: [...value.traits],
    speechExamples: [...value.speechExamples],
    ...(value.voiceProsody ? { voiceProsody: { ...value.voiceProsody } } : {}),
    ...(value.passport ? { passport: { ...value.passport } } : {}),
  };
}

const characterPassport: NonNullable<NarraCharacter["passport"]> = {
  age: 30,
  gender: "female",
  build: "medium",
  hair: "dark",
  eyes: "brown",
  face: "oval",
  outfit: "coat",
};

const detailedCharacter: NarraCharacter = {
  ...character,
  speechExamples: ["Synthetic example"],
  voiceProsody: { pitch: 1, rate: 0.95 },
  passport: characterPassport,
  voiceOverride: "manual-voice",
  stressedName: "А'нна",
  greeting: "Synthetic greeting",
  chatPlaceholder: "Synthetic placeholder",
  expression: "calm",
  appearanceChapter: 1,
  isNarrator: false,
};

describe("Narra character unlock", () => {
  it("unlocks exactly at unlockProgress without chapter assumptions", () => {
    expect(isCharacterUnlocked(0.349, character)).toBe(false);
    expect(isCharacterUnlocked(0.35, character)).toBe(true);
    expect(isCharacterUnlocked(0.8, character)).toBe(true);
  });

  it("clamps malformed progress values", () => {
    expect(isCharacterUnlocked(Number.NaN, 0)).toBe(true);
    expect(isCharacterUnlocked(-2, 0.1)).toBe(false);
    expect(isCharacterUnlocked(4, 0.95)).toBe(true);
  });
});

describe("Narra persisted book state", () => {
  it("retains equal reanalysis objects and arrays while recording analysis completion", () => {
    const state = {
      ...withNarraCharacters(emptyNarraBookState("book-1"), [detailedCharacter], 100),
      analysisError: "previous analysis failure",
    };
    const input = cloneCharacter(detailedCharacter);
    expect(input).not.toBe(detailedCharacter);
    expect(input.traits).not.toBe(detailedCharacter.traits);
    expect(input.passport).not.toBe(detailedCharacter.passport);
    const next = withNarraCharacters(state, [input], 200);

    expect(next).not.toBe(state);
    expect(next.characters).toBe(state.characters);
    expect(next.characters[0]).toBe(state.characters[0]);
    expect(next.analyzedAt).toBe(200);
    expect(next.analysisError).toBeUndefined();
    expect(next.chats).toBe(state.chats);
    expect(next.memories).toBe(state.memories);
    expect(state.analyzedAt).toBe(100);
    expect(state.analysisError).toBe("previous analysis failure");
  });

  it("retains identities after restoring the same saved portrait, voice and stressed name", () => {
    const state = withNarraCharacters(emptyNarraBookState("book-1"), [detailedCharacter], 100);
    const input = {
      ...cloneCharacter(detailedCharacter),
      portraitUri: undefined,
      portraitAssetId: undefined,
      portraitUriOverridesAsset: undefined,
      voiceOverride: undefined,
      stressedName: undefined,
    };
    const next = withNarraCharacters(state, [input], 200);

    expect(next.characters).toBe(state.characters);
    expect(next.characters[0]).toBe(detailedCharacter);
    expect(next.characters[0]).toMatchObject({
      portraitUri: "file:///portrait.png",
      portraitAssetId: "anna-karenina/anna-karenina",
      portraitUriOverridesAsset: true,
      voiceOverride: "manual-voice",
      stressedName: "А'нна",
    });
    expect(input.portraitUri).toBeUndefined();
    expect(input.voiceOverride).toBeUndefined();
  });

  it.each<[string, Partial<NarraCharacter>]>([
    ["placeholder", { chatPlaceholder: "New synthetic placeholder" }],
    ["prosody", { voiceProsody: { pitch: 2, rate: 0.95 } }],
    ["traits", { traits: ["new synthetic trait"] }],
    ["passport", { passport: { ...characterPassport, hair: "light" } }],
  ])(
    "retains updated non-list data for %s instead of returning a stale character",
    (_, updates) => {
      const state = withNarraCharacters(emptyNarraBookState("book-1"), [detailedCharacter], 100);
      const input = { ...cloneCharacter(detailedCharacter), ...updates };
      const next = withNarraCharacters(state, [input], 200);

      expect(next.characters).not.toBe(state.characters);
      expect(next.characters[0]).not.toBe(state.characters[0]);
      expect(next.characters[0]).toEqual(input);
      expect(state.characters[0]).toBe(detailedCharacter);
    },
  );

  it("keeps the existing clearing semantics for optional fields not preserved by reanalysis", () => {
    const state = withNarraCharacters(emptyNarraBookState("book-1"), [detailedCharacter], 100);
    const input = {
      ...cloneCharacter(detailedCharacter),
      voiceProsody: undefined,
      passport: undefined,
      greeting: undefined,
      chatPlaceholder: undefined,
      expression: undefined,
      appearanceChapter: undefined,
      isNarrator: undefined,
    };
    const next = withNarraCharacters(state, [input], 200);

    expect(next.characters[0]).not.toBe(state.characters[0]);
    expect(next.characters[0]).toEqual(input);
    expect(next.characters[0].chatPlaceholder).toBeUndefined();
    expect(next.characters[0].passport).toBeUndefined();
    expect(state.characters[0].chatPlaceholder).toBe("Synthetic placeholder");
  });

  it("changes only one character for a real portrait update among freshly copied inputs", () => {
    const second = { ...detailedCharacter, id: "second" };
    const state = withNarraCharacters(
      emptyNarraBookState("book-1"),
      [detailedCharacter, second],
      100,
    );
    const next = withNarraCharacters(
      state,
      [
        {
          ...cloneCharacter(detailedCharacter),
          portraitUri: "file:///new-portrait.png",
          portraitUriOverridesAsset: false,
        },
        cloneCharacter(second),
      ],
      200,
    );

    expect(next.characters).not.toBe(state.characters);
    expect(next.characters[0]).not.toBe(state.characters[0]);
    expect(next.characters[0].portraitUri).toBe("file:///new-portrait.png");
    expect(next.characters[0].portraitUriOverridesAsset).toBe(false);
    expect(next.characters[1]).toBe(state.characters[1]);
    expect(state.characters[0].portraitUri).toBe("file:///portrait.png");
  });

  it("preserves changed ordering and removals while reusing equal character objects", () => {
    const second = { ...detailedCharacter, id: "second" };
    const state = withNarraCharacters(
      emptyNarraBookState("book-1"),
      [detailedCharacter, second],
      100,
    );
    const reordered = withNarraCharacters(
      state,
      [cloneCharacter(second), cloneCharacter(detailedCharacter)],
      200,
    );
    expect(reordered.characters).not.toBe(state.characters);
    expect(reordered.characters[0]).toBe(second);
    expect(reordered.characters[1]).toBe(detailedCharacter);
    const removed = withNarraCharacters(reordered, [cloneCharacter(second)], 300);
    expect(removed.characters).toHaveLength(1);
    expect(removed.characters[0]).toBe(second);
  });

  it("retains empty arrays and treats absent optional data like undefined", () => {
    const empty = emptyNarraBookState("book-1");
    expect(withNarraCharacters(empty, [], 100).characters).toBe(empty.characters);
    const state = withNarraCharacters(empty, [character], 100);
    const input = { ...cloneCharacter(character), chatPlaceholder: undefined };
    expect(withNarraCharacters(state, [input], 200).characters).toBe(state.characters);
  });

  it("preserves state and character references for a no-op update", () => {
    const state = withNarraCharacters(emptyNarraBookState("book-1"), [character], 100);
    expect(withNarraCharacterUpdates(state, character.id, {})).toBe(state);
    expect(
      withNarraCharacterUpdates(state, character.id, {
        portraitUri: character.portraitUri,
        portraitUriOverridesAsset: true,
      }),
    ).toBe(state);
  });

  it("does not create characters in response to an obsolete portrait result", () => {
    const state = emptyNarraBookState("book-1");
    expect(
      withNarraCharacterUpdates(state, "removed-character", { portraitUri: "file:///old" }),
    ).toBe(state);
  });

  it("updates only the requested character and can explicitly clear its portrait", () => {
    const state = withNarraCharacters(
      emptyNarraBookState("book-1"),
      [character, { ...character, id: "another" }],
      100,
    );
    const updated = withNarraCharacterUpdates(state, character.id, { portraitUri: undefined });
    expect(updated.characters[0]).not.toBe(state.characters[0]);
    expect(updated.characters[0].portraitUri).toBeUndefined();
    expect(updated.characters[1]).toBe(state.characters[1]);
    expect(state.characters[0].portraitUri).toBe("file:///portrait.png");
    expect(updated.chats).toBe(state.chats);
  });

  it("keeps characters, portrait, memory and chat in a serializable state", () => {
    const firstAnalysis = {
      ...withNarraCharacters(emptyNarraBookState("book-1"), [character], 100),
      genre: {
        primary: "fanfiction" as const,
        secondary: ["romance" as const],
        confidence: 0.94,
        evidence: "Публичные люди в вымышленном сюжете",
      },
    };
    const withCharacters = withNarraCharacters(
      firstAnalysis,
      [{ ...character, portraitAssetId: undefined, portraitUri: undefined }],
      123,
    );
    const withMemory = withNarraMemory(withCharacters, character.id, "Любит чай без сахара");
    const complete = withNarraChatMessage(withMemory, character.id, {
      id: "message-1",
      role: "user",
      content: "Запомни это",
      createdAt: 456,
    });
    const restored = JSON.parse(JSON.stringify(complete)) as typeof complete;

    expect(restored.characters[0]).toMatchObject({
      id: "anna",
      portraitAssetId: "anna-karenina/anna-karenina",
      portraitUri: "file:///portrait.png",
      portraitUriOverridesAsset: true,
    });
    expect(restored.memories.anna).toBe("Любит чай без сахара");
    expect(restored.chats.anna[0]?.content).toBe("Запомни это");
    expect(restored.analyzedAt).toBe(123);
    expect(restored.genre).toMatchObject({ primary: "fanfiction", secondary: ["romance"] });
  });
});
