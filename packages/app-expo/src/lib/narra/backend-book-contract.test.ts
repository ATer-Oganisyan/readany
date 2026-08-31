import { describe, expect, it } from "vitest";
import {
  backendConfirmedCharacters,
  backendUnlockProgress,
  parseBackendBinding,
  parseBackendManifest,
  shouldPollBackendManifest,
} from "./backend-book-contract";

function manifest(overrides: Record<string, unknown> = {}) {
  return parseBackendManifest({
    availability: "ready",
    markup: { text_length: 1000, revision: 3 },
    characters: [
      {
        character_key: "stable-id",
        name: "Имя",
        full_name: "Полное имя",
        provisional: false,
        state: "ready",
        first_appearance_text_offset: 400,
        profile: { traits: ["добрый"], extra: "ignored" },
        bundle: null,
      },
    ],
    ...overrides,
  });
}

describe("backend book contract", () => {
  it.each([
    [undefined, null],
    [null, null],
    ["EN_us", "en"],
    ["ru-RU", "ru"],
    ["fil", "fil"],
    ["not a language", null],
  ])("reads nullable language %s in binding and manifest", (input, expected) => {
    expect(
      parseBackendBinding({ resolution: "private", book_edition_id: "id", language: input }, "hash")
        .language,
    ).toBe(expected);
    expect(manifest({ language: input }).language).toBe(expected);
  });
  it("keeps stable IDs and confirmed profiles usable without portraits", () => {
    const characters = backendConfirmedCharacters(manifest(), 0.4);
    expect(characters).toHaveLength(1);
    expect(characters[0]).toMatchObject({
      id: "stable-id",
      name: "Имя",
      unlockProgress: 0.4,
      backendManaged: true,
    });
    expect(characters[0].portraitUri).toBeUndefined();
    expect(characters[0].voice).not.toBe("");
  });
  it("never promotes processing or unknown availability to confirmed", () => {
    expect(backendConfirmedCharacters(manifest({ availability: "processing" }), 1)).toEqual([]);
    expect(backendConfirmedCharacters(manifest({ availability: "new-state" }), 1)).toEqual([]);
  });
  it("excludes provisional and unknown states, keeps confirmed preparing profiles", () => {
    const base = { character_key: "id", name: "A", provisional: false, state: "preparing" };
    expect(backendConfirmedCharacters(manifest({ characters: [base] }), 0)).toHaveLength(1);
    for (const extra of [{ provisional: true }, { state: "unknown" }, { provisional: undefined }])
      expect(
        backendConfirmedCharacters(manifest({ characters: [{ ...base, ...extra }] }), 0),
      ).toHaveLength(0);
  });
  it("preserves manifest order and does not cap the cast at the legacy eight", () => {
    const value = manifest({
      characters: Array.from({ length: 14 }, (_, index) => ({
        character_key: String(index),
        name: "A",
        provisional: false,
        state: "ready",
      })),
    });
    expect(backendConfirmedCharacters(value, 1).map((item) => item.id)).toEqual(
      Array.from({ length: 14 }, (_, index) => String(index)),
    );
  });
  it("clamps appearance and uses profile fallback only without text coordinates", () => {
    const value = manifest();
    expect(backendUnlockProgress({ ...value.characters[0], firstAppearance: 10000 }, value)).toBe(
      0.95,
    );
    expect(
      backendUnlockProgress(
        { ...value.characters[0], profile: { unlockFraction: 0.3 } },
        { ...value, textLength: undefined },
      ),
    ).toBe(0.3);
  });
  it("does not poll for future media", () => {
    const value = manifest();
    value.characters[0].state = "preparing";
    expect(shouldPollBackendManifest(value, 0.3)).toBe(false);
    expect(shouldPollBackendManifest(value, 0.4)).toBe(true);
    expect(shouldPollBackendManifest({ ...value, availability: "processing" }, 0)).toBe(true);
  });
  it("does not apply a future personality snapshot", () => {
    const value = manifest();
    value.characters[0].profile.personalitySnapshots = [
      { cutoffTextOffset: 100, traits: [{ value: "early" }] },
      { cutoffTextOffset: 700, traits: [{ value: "spoiler" }] },
    ];
    expect(backendConfirmedCharacters(value, 0.5)[0].traits).toEqual(["early"]);
    expect(backendConfirmedCharacters(value, 0.05)[0].traits).toEqual([]);
  });
  it("keeps every user-facing backend field from the latest reached snapshot", () => {
    const value = manifest();
    value.characters[0].profile = {
      analysisSource: "v3",
      role: "Главный герой",
      appearancePrompt: "Высокий человек в тёмном пальто",
      customFact: "Любит шахматы",
      traits: ["финальная черта"],
      personalitySnapshots: [
        {
          cutoffTextOffset: 100,
          status: "preliminary",
          traits: [{ value: "наблюдательный", confidence: 0.9 }],
          relationships: ["Знаком с Анной"],
        },
        {
          cutoffTextOffset: 700,
          traits: [{ value: "будущая черта" }],
          relationships: ["Будущий спойлер"],
        },
      ],
    };

    const character = backendConfirmedCharacters(value, 0.5)[0];
    expect(character.traits).toEqual(["наблюдательный"]);
    expect(character.profileDetails).toEqual([
      { key: "role", value: "Главный герой" },
      { key: "traits", value: ["наблюдательный"] },
      { key: "appearancePrompt", value: "Высокий человек в тёмном пальто" },
      { key: "customFact", value: "Любит шахматы" },
      { key: "relationships", value: ["Знаком с Анной"] },
    ]);
  });
  it("does not expose final values for progressive fields before the first snapshot", () => {
    const value = manifest();
    value.characters[0].profile = {
      role: "Герой",
      traits: ["спойлер"],
      secret: "финальный секрет",
      personalitySnapshots: [
        { cutoffTextOffset: 700, traits: [{ value: "позже" }], secret: "раскрытый секрет" },
      ],
    };

    expect(backendConfirmedCharacters(value, 0.5)[0].profileDetails).toEqual([
      { key: "role", value: "Герой" },
    ]);
  });
  it("validates private upload state conservatively and accepts a registration race to catalog", () => {
    expect(
      parseBackendBinding({ resolution: "private", book_edition_id: "id" }, "hash").sourceUploaded,
    ).toBe(false);
    expect(
      parseBackendBinding(
        { resolution: "private", book_edition_id: "id", source_uploaded: true },
        "hash",
      ).sourceUploaded,
    ).toBe(true);
    expect(
      parseBackendBinding({ resolution: "catalog", book_edition_id: "id" }, "hash").sourceUploaded,
    ).toBe(true);
    expect(() =>
      parseBackendBinding({ resolution: "future", book_edition_id: "id" }, "hash"),
    ).toThrow();
  });
  it("drops malformed assets independently of profiles", () => {
    const value = manifest({
      characters: [
        {
          character_key: "id",
          name: "A",
          provisional: false,
          state: "ready",
          bundle: {
            version: "character-bundle-v3",
            assets: [
              { type: "primary_portrait", download_path: "https://unsafe/", content_hash: "bad" },
            ],
          },
        },
      ],
    });
    expect(value.characters[0].assets).toEqual([]);
    expect(backendConfirmedCharacters(value, 1)).toHaveLength(1);
  });
});
