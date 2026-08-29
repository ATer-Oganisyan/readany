import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendBookManifest } from "./backend-book-api";

const mocks = vi.hoisted(() => ({
  files: new Map<string, number>(),
  requestDownload: vi.fn(async () => "https://storage/signed"),
  hash: vi.fn(async () => "a".repeat(64)),
  downloads: vi.fn(),
  writeText: vi.fn(),
  readText: vi.fn(),
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  FileSystemSessionType: { BACKGROUND: 0 },
  async getInfoAsync(path: string) {
    if (path.endsWith("narra-backend-books") || /narra-backend-books\/[^/]+$/.test(path)) {
      return { exists: true, isDirectory: true, uri: path };
    }
    const size = mocks.files.get(path);
    return size === undefined
      ? { exists: false, isDirectory: false, uri: path }
      : { exists: true, isDirectory: false, uri: path, size };
  },
  makeDirectoryAsync: vi.fn(),
  createDownloadResumable(_url: string, path: string) {
    return {
      async downloadAsync() {
        mocks.downloads(path);
        mocks.files.set(path, 64);
        return { status: 200, uri: path };
      },
    };
  },
  async deleteAsync(path: string) {
    mocks.files.delete(path);
  },
  async moveAsync({ from, to }: { from: string; to: string }) {
    mocks.files.set(to, mocks.files.get(from) ?? 0);
    mocks.files.delete(from);
  },
  writeAsStringAsync: mocks.writeText,
  readAsStringAsync: mocks.readText,
}));
vi.mock("./backend-file-hash", () => ({ sha256BackendFile: mocks.hash }));
vi.mock("./backend-book-api", () => ({ requestBackendDownloadUrl: mocks.requestDownload }));

import {
  loadCachedBackendCharacters,
  materializeBackendManifest,
  persistBackendManifestCharacters,
  projectBackendManifestCharacters,
} from "./backend-book-cache";

function manifest(assetTypes: string[]): BackendBookManifest {
  return {
    source: "v2",
    availability: "ready",
    readerTextOffset: 100,
    readingFraction: 0.1,
    textLength: 1_000,
    revision: 1,
    characters: [
      {
        characterKey: "anna",
        name: "Анна",
        fullName: "Анна Каренина",
        firstAppearanceTextOffset: 90,
        state: "ready",
        profile: {
          gender: "female",
          role: "Героиня",
          description: "Анна — центральная героиня романа.",
        },
        bundle: {
          version: "character-bundle-v1",
          assets: assetTypes.map((type, index) => ({
            assetId: `asset-${index}`,
            type: type as "primary_portrait" | "greeting_audio" | "idle_animation",
            contentHash: "a".repeat(64),
            mimeType: type === "primary_portrait" ? "image/png" : "audio/mpeg",
            byteSize: 64,
            downloadPath: `/v2/media/${index}`,
          })),
        },
      },
    ],
  };
}

describe("backend book media cache", () => {
  beforeEach(() => {
    mocks.files.clear();
    vi.clearAllMocks();
    mocks.readText.mockRejectedValue(new Error("missing cache"));
  });

  it("projects and persists character markup without downloading media", async () => {
    const value = manifest(["primary_portrait", "greeting_audio", "idle_animation"]);
    const characters = projectBackendManifestCharacters(value);

    expect(characters).toEqual([
      expect.objectContaining({
        id: "anna",
        name: "Анна",
        description: "Анна — центральная героиня романа.",
        unlockProgress: 0.09,
        mediaSource: "backend",
        mediaState: "preparing",
        analysisState: "confirmed",
      }),
    ]);
    expect(characters[0]?.portraitUri).toBeUndefined();
    expect(mocks.downloads).not.toHaveBeenCalled();

    await persistBackendManifestCharacters("book-1", value, characters);
    expect(mocks.downloads).not.toHaveBeenCalled();
    expect(mocks.writeText).toHaveBeenCalledOnce();
    const persisted = JSON.parse(String(mocks.writeText.mock.calls[0]?.[1]));
    expect(persisted.characters).toEqual([
      expect.objectContaining({ id: "anna", mediaState: "preparing" }),
    ]);
  });

  it("marks processing-manifest characters as provisional display records", () => {
    const value = manifest([]);
    const character = value.characters[0];
    if (!character) throw new Error("character fixture is missing");
    value.availability = "processing";
    value.characters[0] = {
      ...character,
      characterKey: "provisional:anna",
      provisional: true,
      state: "preparing",
      bundle: null,
    };

    expect(projectBackendManifestCharacters(value)[0]).toMatchObject({
      id: "provisional:anna",
      analysisState: "provisional",
      mediaSource: "backend",
      mediaState: "preparing",
    });
  });

  it("selects the latest personality snapshot reached by local reading progress", () => {
    const value = manifest([]);
    const character = value.characters[0];
    if (!character) throw new Error("character fixture is missing");
    character.profile = {
      ...character.profile,
      traits: ["финальная строгая черта"],
      personalityTimelineVersion: "progressive-personality-v1",
      personalitySnapshots: [
        {
          cutoffTextOffset: 100,
          status: "preliminary",
          traits: [{ value: "наблюдательная", evidenceLevel: "single_scene" }],
        },
        {
          cutoffTextOffset: 600,
          status: "supported",
          traits: [{ value: "решительная", evidenceLevel: "repeated" }],
        },
      ],
    };

    expect(projectBackendManifestCharacters(value, [], 0.05)[0]).toMatchObject({
      traits: [],
      personalityStatus: "insufficient_evidence",
    });
    expect(projectBackendManifestCharacters(value, [], 0.2)[0]).toMatchObject({
      traits: ["наблюдательная"],
      personalityStatus: "preliminary",
    });
    expect(projectBackendManifestCharacters(value, [], 0.8)[0]).toMatchObject({
      traits: ["решительная"],
      personalityStatus: "supported",
    });
  });

  it("keeps strict traits from a legacy publication without a timeline version", () => {
    const value = manifest([]);
    const character = value.characters[0];
    if (!character) throw new Error("character fixture is missing");
    character.profile = {
      ...character.profile,
      traits: ["строгая черта старой публикации"],
      personalitySnapshots: [],
    };

    expect(projectBackendManifestCharacters(value, [], 0.5)[0]).toMatchObject({
      traits: ["строгая черта старой публикации"],
    });
    expect(projectBackendManifestCharacters(value, [], 0.5)[0]?.personalityStatus).toBeUndefined();
  });

  it("publishes all three cached media paths together", async () => {
    const [character] = await materializeBackendManifest(
      "book-1",
      manifest(["primary_portrait", "greeting_audio", "idle_animation"]),
    );
    expect(character).toMatchObject({
      mediaSource: "backend",
      mediaState: "ready",
      portraitUri: expect.stringContaining("primary_portrait"),
      greetingAudioUri: expect.stringContaining("greeting_audio"),
      idleAnimationUri: expect.stringContaining("idle_animation"),
    });
    expect(mocks.downloads).toHaveBeenCalledTimes(3);
  });

  it("downloads media only for characters reached by local reader progress", async () => {
    const value = manifest(["primary_portrait"]);
    const anna = value.characters[0];
    if (!anna) throw new Error("character fixture is missing");
    value.characters.push({
      ...anna,
      characterKey: "future",
      name: "Будущий герой",
      fullName: "Будущий герой",
      firstAppearanceTextOffset: 900,
      bundle: {
        version: "character-bundle-v1",
        assets: [
          {
            assetId: "future-audio",
            type: "greeting_audio",
            contentHash: "a".repeat(64),
            mimeType: "audio/mpeg",
            byteSize: 64,
            downloadPath: "/v2/media/future-audio",
          },
        ],
      },
    });

    const characters = await materializeBackendManifest("book-1", value, 0.1);

    expect(characters).toHaveLength(2);
    expect(characters[0]?.portraitUri).toContain("primary_portrait");
    expect(characters[1]?.greetingAudioUri).toBeUndefined();
    expect(characters[1]?.mediaState).toBe("preparing");
    expect(mocks.requestDownload).toHaveBeenCalledOnce();
  });

  it("keeps ready cached portraits visible while the same bundle is revalidated", () => {
    const value = manifest(["primary_portrait", "greeting_audio", "idle_animation"]);
    const [projected] = projectBackendManifestCharacters(value);
    const cached = {
      ...projected,
      portraitUri: "file:///documents/narra-backend-books/book-1/primary_portrait.png",
      greetingAudioUri: "file:///documents/narra-backend-books/book-1/greeting.mp3",
      idleAnimationUri: "file:///documents/narra-backend-books/book-1/idle.mp4",
      mediaState: "ready" as const,
    };

    expect(projectBackendManifestCharacters(value, [cached])[0]).toMatchObject({
      portraitUri: cached.portraitUri,
      greetingAudioUri: cached.greetingAudioUri,
      idleAnimationUri: cached.idleAnimationUri,
      mediaState: "ready",
    });
  });

  it("does not request or download an unchanged media bundle again", async () => {
    const value = manifest(["primary_portrait", "greeting_audio", "idle_animation"]);
    await materializeBackendManifest("book-1", value);
    mocks.downloads.mockClear();
    mocks.requestDownload.mockClear();

    await materializeBackendManifest("book-1", value);

    expect(mocks.requestDownload).not.toHaveBeenCalled();
    expect(mocks.downloads).not.toHaveBeenCalled();
  });

  it("exposes a ready portrait without waiting for audio and animation", async () => {
    const [character] = await materializeBackendManifest("book-1", manifest(["primary_portrait"]));
    expect(character).toMatchObject({ mediaSource: "backend", mediaState: "preparing" });
    expect(character?.portraitUri).toContain("primary_portrait");
    expect(character?.greetingAudioUri).toBeUndefined();
    expect(character?.idleAnimationUri).toBeUndefined();
    expect(mocks.downloads).toHaveBeenCalledOnce();
  });

  it("re-homes persisted media paths after an iOS container change", async () => {
    mocks.readText.mockResolvedValueOnce(
      JSON.stringify({
        manifest: manifest([]),
        characters: [
          {
            id: "anna",
            portraitUri:
              "file:///old/container/Documents/narra-backend-books/book-1/primary_portrait-a.png",
          },
        ],
      }),
    );
    await expect(loadCachedBackendCharacters("book-1")).resolves.toEqual([
      expect.objectContaining({
        portraitUri: "file:///documents/narra-backend-books/book-1/primary_portrait-a.png",
      }),
    ]);
  });
});
