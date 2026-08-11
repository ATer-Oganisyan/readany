import { describe, expect, it } from "vitest";
import {
  emptyNarraBookState,
  isCharacterUnlocked,
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
  portraitUri: "file:///portrait.png",
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
  it("keeps characters, portrait, memory and chat in a serializable state", () => {
    const firstAnalysis = withNarraCharacters(emptyNarraBookState("book-1"), [character], 100);
    const withCharacters = withNarraCharacters(
      firstAnalysis,
      [{ ...character, portraitUri: undefined }],
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
      portraitUri: "file:///portrait.png",
    });
    expect(restored.memories.anna).toBe("Любит чай без сахара");
    expect(restored.chats.anna[0]?.content).toBe("Запомни это");
    expect(restored.analyzedAt).toBe(123);
  });

  it("does not expose stale partial media for a backend character", () => {
    const local = withNarraCharacters(emptyNarraBookState("book-1"), [character]);
    const backend = withNarraCharacters(local, [
      {
        ...character,
        portraitUri: undefined,
        mediaSource: "backend",
        mediaState: "preparing",
      },
    ]);

    expect(backend.characters[0]).toMatchObject({
      id: "anna",
      mediaSource: "backend",
      mediaState: "preparing",
    });
    expect(backend.characters[0]?.portraitUri).toBeUndefined();
  });
});
