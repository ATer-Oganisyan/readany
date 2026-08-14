import { describe, expect, it } from "vitest";
import { emptyNarraBookState, withNarraCharacters } from "./domain";
import type { NarraCharacter } from "./types";

function character(overrides: Partial<NarraCharacter> = {}): NarraCharacter {
  return {
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
    ...overrides,
  };
}

describe("backend character media precedence", () => {
  it("does not reuse stale generated local media while backend media is preparing", () => {
    const previous = character({
      portraitUri: "file:///local-generated-portrait.png",
      greetingAudioUri: "file:///local-greeting.mp3",
      idleAnimationUri: "file:///local-idle.mp4",
      mediaSource: "local",
    });
    const incoming = character({
      mediaSource: "backend",
      mediaState: "preparing",
    });

    const state = withNarraCharacters(
      { ...emptyNarraBookState("book-1"), characters: [previous] },
      [incoming],
    );

    expect(state.characters[0]).toMatchObject({
      mediaSource: "backend",
      mediaState: "preparing",
    });
    expect(state.characters[0]?.portraitUri).toBeUndefined();
    expect(state.characters[0]?.greetingAudioUri).toBeUndefined();
    expect(state.characters[0]?.idleAnimationUri).toBeUndefined();
  });

  it("preserves an explicit user portrait override across a backend refresh", () => {
    const previous = character({
      portraitUri: "file:///user-portrait.png",
      portraitUriOverridesAsset: true,
      mediaSource: "local",
    });
    const incoming = character({
      portraitUri: "https://cdn.example/backend-portrait.png",
      mediaSource: "backend",
      mediaState: "ready",
    });

    const state = withNarraCharacters(
      { ...emptyNarraBookState("book-1"), characters: [previous] },
      [incoming],
    );

    expect(state.characters[0]?.portraitUri).toBe("file:///user-portrait.png");
    expect(state.characters[0]?.portraitUriOverridesAsset).toBe(true);
  });
});
