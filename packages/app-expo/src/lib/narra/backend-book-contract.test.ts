import { describe, expect, it } from "vitest";
import {
  backendConfirmedCharacters,
  backendUnlockProgress,
  parseBackendBinding,
  parseBackendCharactersPreview,
  parseBackendManifest,
  shouldPollBackendManifest,
} from "./backend-book-contract";

it("preserves wire source identity separately from publication hash and binds legacy manifests to the request", () => {
  const binding = { bookEditionId: "edition-a", contentSha256: "a".repeat(64) };
  const wire = {
    availability: "ready",
    characters: [],
    content_hash: "publication-hash",
    book: { book_edition_id: binding.bookEditionId, content_sha256: binding.contentSha256 },
  };
  const parsed = parseBackendManifest(wire, binding);
  expect(parsed.bookEditionId).toBe(binding.bookEditionId);
  expect(parsed.sourceContentSha256).toBe(binding.contentSha256);
  expect(parsed.contentHash).toBe("publication-hash");
  const legacy = parseBackendManifest({ availability: "ready", characters: [] }, binding);
  binding.bookEditionId = "edition-b";
  expect(legacy.requestIdentity?.bookEditionId).toBe("edition-a");
  expect(legacy.bookEditionId).toBeUndefined();
  expect(Object.isFrozen(legacy.requestIdentity)).toBe(true);
});

it.each([
  { book_edition_id: "edition-b" },
  { content_sha256: "b".repeat(64) },
  { book_edition_id: null },
  { content_sha256: "invalid" },
])("rejects contradictory or malformed wire manifest identity %j", (book) => {
  expect(() =>
    parseBackendManifest(
      { availability: "ready", characters: [], book },
      { bookEditionId: "edition-a", contentSha256: "a".repeat(64) },
    ),
  ).toThrow(/manifest|Manifest/);
});

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
    const value = manifest();
    expect(value.charactersStatus).toBe("full_ready");
    const characters = backendConfirmedCharacters(value, 0.4);
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
  it("keeps terminal analysis state safe and preserves a real bio separately from role", () => {
    const value = manifest({
      availability: "failed",
      analysis: {
        run_id: "run-id",
        stage: "scan",
        status: "failed",
        retryable: true,
        error_code: "ANALYSIS_FAILED",
        updated_at: "2026-08-31T12:00:00.000Z",
        error_detail: "must not be exposed",
      },
      characters: [
        {
          character_key: "stable-id",
          name: "Андрей",
          provisional: false,
          state: "ready",
          profile: { role: "Главный герой", description: "Князь и офицер." },
        },
      ],
    });
    expect(value.analysis).toEqual({
      runId: "run-id",
      stage: "scan",
      status: "failed",
      retryable: true,
      errorCode: "ANALYSIS_FAILED",
      updatedAt: "2026-08-31T12:00:00.000Z",
      completedScanChunks: undefined,
      totalScanChunks: undefined,
    });
    expect(value.characters[0].fullName).toBe("");
    expect(value.characters[0].profile).toMatchObject({
      role: "Главный герой",
      description: "Князь и офицер.",
    });
    expect(JSON.stringify(value)).not.toContain("must not be exposed");
  });
  it("parses the separate provisional roster without promoting it to full markup", () => {
    const preview = parseBackendCharactersPreview({
      contract_version: "book-characters-preview-v1",
      book_edition_id: "edition-1",
      status: "preview_ready",
      run_id: "run-1",
      poll_after_ms: 7000,
      analysis: {
        stage: "scan",
        status: "running",
        completed_scan_chunks: 4,
        total_scan_chunks: 20,
      },
      characters: [
        {
          character_key: "provisional:anna",
          name: "Анна",
          full_name: "Анна Каренина",
          provisional: true,
          state: "preparing",
          profile: { role: "Профиль формируется" },
          bundle: null,
        },
        {
          character_key: "unsafe-final",
          name: "Финальный",
          provisional: false,
          state: "ready",
        },
      ],
    });
    expect(preview).toMatchObject({
      bookEditionId: "edition-1",
      status: "preview_ready",
      runId: "run-1",
      pollAfterMs: 7000,
      analysis: { completedScanChunks: 4, totalScanChunks: 20 },
    });
    expect(preview.characters.map((character) => character.key)).toEqual(["provisional:anna"]);
    expect(backendConfirmedCharacters(manifest({ availability: "processing" }), 1)).toEqual([]);
  });
  it("drops provisional rows when the preview endpoint reports full readiness", () => {
    const preview = parseBackendCharactersPreview({
      contract_version: "book-characters-preview-v1",
      book_edition_id: "edition-1",
      status: "full_ready",
      characters: [
        {
          character_key: "stale",
          name: "Старый preview",
          provisional: true,
          state: "preparing",
        },
      ],
    });
    expect(preview.characters).toEqual([]);
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
    expect(shouldPollBackendManifest({ ...value, availability: "failed" }, 1)).toBe(false);
    expect(shouldPollBackendManifest({ ...value, availability: "cancelled" }, 1)).toBe(false);
    expect(shouldPollBackendManifest({ ...value, availability: "unavailable" }, 1)).toBe(false);
  });
  it("shows the complete backend character regardless of personality snapshot progress", () => {
    const value = manifest();
    value.characters[0].profile.personalitySnapshots = [
      { cutoffTextOffset: 100, traits: [{ value: "early" }] },
      { cutoffTextOffset: 700, traits: [{ value: "spoiler" }] },
    ];
    expect(backendConfirmedCharacters(value, 0.5)[0].traits).toEqual(["spoiler"]);
    expect(backendConfirmedCharacters(value, 0.05)[0].traits).toEqual(["spoiler"]);
  });
  it("keeps every user-facing field from the complete backend profile", () => {
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
    expect(character.traits).toEqual(["будущая черта"]);
    expect(character.profileDetails).toEqual([
      { key: "role", value: "Главный герой" },
      { key: "traits", value: ["будущая черта"] },
      { key: "appearancePrompt", value: "Высокий человек в тёмном пальто" },
      { key: "customFact", value: "Любит шахматы" },
      { key: "relationships", value: ["Будущий спойлер"] },
    ]);
  });
  it("shows final snapshot values before the first personality snapshot is reached", () => {
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
      { key: "traits", value: ["позже"] },
      { key: "secret", value: "раскрытый секрет" },
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
  it.each(["character-bundle-v3", "character-bundle-v3:r2", "character-bundle-v3:r37"])(
    "accepts assets from supported bundle version %s",
    (version) => {
      const value = manifest({
        characters: [
          {
            character_key: "id",
            name: "A",
            provisional: false,
            state: "ready",
            bundle: {
              version,
              assets: [
                {
                  asset_id: "audio-id",
                  type: "greeting_audio",
                  content_hash: "a".repeat(64),
                  mime_type: "audio/wav",
                  byte_size: 1024,
                  download_path: "/v2/books/edition/assets/audio-id",
                },
              ],
            },
          },
        ],
      });

      expect(value.characters[0].assets).toEqual([
        expect.objectContaining({ assetId: "audio-id", type: "greeting_audio" }),
      ]);
    },
  );
  it.each(["character-bundle-v2", "character-bundle-v3:r0", "character-bundle-v3:r02"])(
    "rejects assets from unsupported bundle version %s",
    (version) => {
      const value = manifest({
        characters: [
          {
            character_key: "id",
            name: "A",
            provisional: false,
            state: "ready",
            bundle: {
              version,
              assets: [
                {
                  asset_id: "audio-id",
                  type: "greeting_audio",
                  content_hash: "a".repeat(64),
                  mime_type: "audio/wav",
                  byte_size: 1024,
                  download_path: "/v2/books/edition/assets/audio-id",
                },
              ],
            },
          },
        ],
      });

      expect(value.characters[0].assets).toEqual([]);
    },
  );
});
