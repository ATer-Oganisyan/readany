import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendCharacterAsset } from "./backend-book-contract";
const runtime = vi.hoisted(() => ({
  download: vi.fn(),
  hash: vi.fn(),
  info: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
  updateCharacter: vi.fn(),
  libraryState: { books: [] as unknown[] },
  narraState: { books: {} as Record<string, unknown> },
  serial: 0,
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => `temporary-${++runtime.serial}` }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  getInfoAsync: runtime.info,
  makeDirectoryAsync: vi.fn(),
  moveAsync: runtime.move,
  deleteAsync: runtime.remove,
}));
vi.mock("./backend-file-download", () => ({ downloadVerifiedBackendFile: runtime.download }));
vi.mock("./backend-file-hash", () => ({ sha256BackendFile: runtime.hash }));
vi.mock("@/stores/library-store", () => ({
  useLibraryStore: { getState: () => runtime.libraryState },
}));
vi.mock("@/stores/narra-store", () => ({
  useNarraStore: {
    getState: () => ({ ...runtime.narraState, updateCharacter: runtime.updateCharacter }),
  },
}));
import {
  loadBackendCharacterMedia,
  materializeBackendCharacterAsset,
  planBackendCharacterMedia,
} from "./backend-character-media";
import type { NarraCharacter } from "./types";
const asset: BackendCharacterAsset = {
  assetId: "id",
  type: "primary_portrait",
  contentHash: "b".repeat(64),
  mimeType: "image/png",
  byteSize: 42,
  downloadPath: "/v2/books/id/media/id/download",
};
beforeEach(() => {
  vi.clearAllMocks();
  runtime.info.mockResolvedValue({ exists: false });
  runtime.download.mockResolvedValue(undefined);
  runtime.hash.mockResolvedValue(asset.contentHash);
  runtime.move.mockResolvedValue(undefined);
  runtime.libraryState.books = [];
  runtime.narraState.books = {};
});
describe("verified character media cache", () => {
  it("moves only verified temporary files and passes exact hash/size to the downloader", async () => {
    const uri = await materializeBackendCharacterAsset("download", asset);
    expect(runtime.download).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSha256: asset.contentHash,
        expectedByteSize: 42,
        destinationPath: expect.stringContaining(".tmp"),
      }),
    );
    expect(runtime.move).toHaveBeenCalledWith({ from: expect.stringContaining(".tmp"), to: uri });
    expect(runtime.remove).toHaveBeenCalledWith(expect.stringContaining(".tmp"), {
      idempotent: true,
    });
  });
  it("does not publish or delete a previous asset when a new download fails verification", async () => {
    runtime.download.mockRejectedValue(new Error("checksum mismatch"));
    await expect(materializeBackendCharacterAsset("corrupt", asset)).rejects.toThrow(
      "checksum mismatch",
    );
    expect(runtime.move).not.toHaveBeenCalled();
    expect(runtime.remove.mock.calls.every(([path]) => path.endsWith(".tmp"))).toBe(true);
  });
  it("verifies an existing hash once and reuses it without another download or hash", async () => {
    runtime.info.mockResolvedValue({ exists: true, isDirectory: false, size: 42 });
    const first = await materializeBackendCharacterAsset("cached", asset);
    expect(await materializeBackendCharacterAsset("cached", asset)).toBe(first);
    expect(runtime.hash).toHaveBeenCalledTimes(1);
    expect(runtime.download).not.toHaveBeenCalled();
  });
  it("cancelling one consumer does not cancel the download needed by another", async () => {
    let complete!: () => void;
    runtime.download.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const controller = new AbortController();
    const first = materializeBackendCharacterAsset("shared", asset, controller.signal);
    const rejected = expect(first).rejects.toThrow("cancelled");
    const second = materializeBackendCharacterAsset("shared", asset);
    await vi.waitFor(() => expect(runtime.download).toHaveBeenCalledTimes(1));
    controller.abort();
    await rejected;
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(runtime.download.mock.calls[0][0].signal.aborted).toBe(false);
    complete();
    await expect(second).resolves.toContain(asset.contentHash);
  });
  it("treats a screen cancellation as an expected end of background media work", async () => {
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    runtime.download.mockImplementation(
      () =>
        new Promise<void>(() => {
          started();
        }),
    );
    const character = {
      id: "hero",
      name: "Герой",
      fullName: "Герой",
      role: "",
      gender: "male" as const,
      voice: "",
      traits: [],
      speechStyle: "",
      speechExamples: [],
      appearancePrompt: "",
      unlockProgress: 0,
      backendManaged: true,
      backendAssets: [asset],
    };
    runtime.libraryState.books = [{ id: "book", progress: 0, deletedAt: undefined }];
    runtime.narraState.books = {
      book: {
        backendBinding: { bookEditionId: "edition" },
        characters: [character],
      },
    };
    const controller = new AbortController();
    const loading = loadBackendCharacterMedia("book", 0, controller.signal);
    await didStart;
    controller.abort();

    await expect(loading).resolves.toBeUndefined();
  });
  it("retains the server audio format for WAV greeting files", async () => {
    await expect(
      materializeBackendCharacterAsset("wav", {
        ...asset,
        type: "greeting_audio",
        mimeType: "audio/wav",
      }),
    ).resolves.toMatch(/\.wav$/);
  });
});

describe("character media priority", () => {
  const character = (
    id: string,
    unlockProgress: number,
    assets: BackendCharacterAsset[],
  ): NarraCharacter => ({
    id,
    name: id,
    fullName: id,
    role: "",
    gender: "male",
    voice: "",
    traits: [],
    speechStyle: "",
    speechExamples: [],
    appearancePrompt: "",
    unlockProgress,
    backendManaged: true,
    backendAssets: assets,
  });
  const typedAsset = (id: string, type: BackendCharacterAsset["type"]): BackendCharacterAsset => ({
    ...asset,
    assetId: id,
    type,
    contentHash: id.padEnd(64, "b").slice(0, 64),
  });

  it("loads visible portraits first and warms only the next character portrait", () => {
    const visiblePortrait = typedAsset("1", "primary_portrait");
    const visibleAudio = typedAsset("2", "greeting_audio");
    const nextPortrait = typedAsset("3", "primary_portrait");
    const laterPortrait = typedAsset("4", "primary_portrait");
    const plan = planBackendCharacterMedia(
      [
        character("visible", 0.1, [visibleAudio, visiblePortrait]),
        character("later", 0.8, [laterPortrait]),
        character("next", 0.3, [nextPortrait, typedAsset("5", "idle_animation")]),
      ],
      0.2,
    );

    expect(plan.unlockedPortraits).toEqual([
      expect.objectContaining({ characterId: "visible", asset: visiblePortrait }),
    ]);
    expect(plan.nextPortrait).toEqual([
      expect.objectContaining({ characterId: "next", asset: nextPortrait }),
    ]);
    expect(plan.unlockedRemainder).toEqual([
      expect.objectContaining({ characterId: "visible", asset: visibleAudio }),
    ]);
  });
});
