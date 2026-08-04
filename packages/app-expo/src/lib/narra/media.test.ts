import { describe, expect, it, vi } from "vitest";
import type { NarraCharacter } from "./types";

vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///documents/" }));
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ narraGatewayRequest: vi.fn() }));

import { buildSceneImagePrompt, normalizePersistedNarraMediaUri } from "./media";

const anna: NarraCharacter = {
  id: "anna",
  name: "Анна",
  fullName: "Анна Каренина",
  role: "Главная героиня",
  gender: "female",
  voice: "Che",
  traits: ["искренняя"],
  speechStyle: "эмоциональная",
  speechExamples: [],
  appearancePrompt: "аристократичная женщина",
  passport: {
    age: 28,
    gender: "female",
    build: "стройная",
    hair: "тёмные волосы",
    eyes: "серые глаза",
    face: "овальное лицо",
    outfit: "чёрное платье XIX века",
  },
  unlockProgress: 0,
};

const vronsky: NarraCharacter = {
  ...anna,
  id: "vronsky",
  name: "Вронский",
  fullName: "Алексей Вронский",
  gender: "male",
  passport: {
    age: 30,
    gender: "male",
    build: "атлетичный",
    hair: "светлые волосы",
    eyes: "голубые глаза",
    face: "правильные черты",
    outfit: "мундир XIX века",
  },
};

describe("scene image prompt", () => {
  it("adds passport canon only for characters mentioned in the excerpt", () => {
    const prompt = buildSceneImagePrompt("Бал", "Анна вошла в зал и остановилась у двери.", [
      anna,
      vronsky,
    ]);

    expect(prompt).toContain("Анна Каренина");
    expect(prompt).toContain("тёмные волосы");
    expect(prompt).not.toContain("Алексей Вронский");
    expect(prompt).toContain("Не добавляй отсутствующих героев");
  });
});

describe("persisted Narra media URI", () => {
  it("moves an iOS URI from an old app container into the current document directory", () => {
    expect(
      normalizePersistedNarraMediaUri(
        "file:///var/mobile/Containers/Data/Application/OLD/Documents/narra-media/book-hero.png",
      ),
    ).toBe("file:///documents/narra-media/book-hero.png");
  });

  it("leaves remote and unrelated local URIs untouched", () => {
    expect(normalizePersistedNarraMediaUri("https://cdn.example/hero.png")).toBe(
      "https://cdn.example/hero.png",
    );
    expect(normalizePersistedNarraMediaUri("file:///documents/covers/book.png")).toBe(
      "file:///documents/covers/book.png",
    );
  });
});
