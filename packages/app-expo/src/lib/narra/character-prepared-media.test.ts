import { describe, expect, it } from "vitest";
import {
  resolvePreparedGreetingAudioUri,
  resolvePreparedIdleAnimationUri,
} from "./character-prepared-media";
import type { NarraCharacter } from "./types";

function character(overrides: Partial<NarraCharacter> = {}): NarraCharacter {
  return {
    id: "raskolnikov",
    name: "Родион",
    fullName: "Родион Раскольников",
    role: "Главный герой",
    gender: "male",
    voice: "Bys",
    traits: ["замкнутый"],
    speechStyle: "сдержанная",
    speechExamples: [],
    appearancePrompt: "молодой человек",
    unlockProgress: 0,
    greeting: "Вы хотели со мной поговорить?",
    greetingAudioUri: "file:///documents/narra-media/greeting.wav",
    idleAnimationUri: "file:///documents/narra-media/idle.mp4",
    ...overrides,
  };
}

describe("prepared character media", () => {
  it("uses pre-generated audio only for the matching v3 greeting", () => {
    const hero = character();

    expect(resolvePreparedGreetingAudioUri(hero, "  Вы хотели со мной поговорить?  ")).toBe(
      hero.greetingAudioUri,
    );
    expect(resolvePreparedGreetingAudioUri(hero, "Другой ответ героя")).toBeNull();
  });

  it("exposes the pre-generated idle animation for the character profile", () => {
    expect(resolvePreparedIdleAnimationUri(character())).toBe(
      "file:///documents/narra-media/idle.mp4",
    );
    expect(resolvePreparedIdleAnimationUri(character({ idleAnimationUri: "  " }))).toBeNull();
  });
});
