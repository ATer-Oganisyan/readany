import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendCharacterAsset } from "./backend-book-contract";
const runtime = vi.hoisted(() => ({
  download: vi.fn(),
  hash: vi.fn(),
  info: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
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
vi.mock("@/stores/library-store", () => ({ useLibraryStore: { getState: () => ({ books: [] }) } }));
vi.mock("@/stores/narra-store", () => ({ useNarraStore: { getState: () => ({ books: {} }) } }));
import { materializeBackendCharacterAsset } from "./backend-character-media";
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
    expect(runtime.download.mock.calls[0][0].signal.aborted).toBe(false);
    complete();
    await expect(second).resolves.toContain(asset.contentHash);
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
