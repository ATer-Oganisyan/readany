import { beforeEach, describe, expect, it, vi } from "vitest";
import { COVER_DOWNLOAD_RETRY, downloadVerifiedBackendFile } from "./backend-file-download";
import { NarraServiceError } from "./errors";

const mocks = vi.hoisted(() => ({
  deleteAsync: vi.fn(),
  downloadFile: vi.fn(),
  getInfoAsync: vi.fn(),
  requestBackendDownloadUrl: vi.fn(),
  sha256BackendFile: vi.fn(),
}));

vi.mock("@readany/core/services", () => ({
  getPlatformService: () => ({ downloadFile: mocks.downloadFile }),
}));

vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: mocks.deleteAsync,
  getInfoAsync: mocks.getInfoAsync,
}));

vi.mock("./backend-catalog-api", () => ({
  requestBackendDownloadUrl: mocks.requestBackendDownloadUrl,
}));

vi.mock("./backend-file-hash", () => ({
  sha256BackendFile: mocks.sha256BackendFile,
}));

describe("verified backend file download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteAsync.mockResolvedValue(undefined);
    mocks.getInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 42 });
    mocks.sha256BackendFile.mockResolvedValue("a".repeat(64));
  });

  it("uses foreground platform downloads and re-signs after a transient failure", async () => {
    mocks.requestBackendDownloadUrl
      .mockResolvedValueOnce("https://objects.example/first")
      .mockResolvedValueOnce("https://objects.example/second");
    mocks.downloadFile
      .mockRejectedValueOnce(new Error("hostname could not be found"))
      .mockResolvedValueOnce(undefined);

    await downloadVerifiedBackendFile({
      downloadPath: "/v2/books/book-1/source/download",
      destinationPath: "file:///cache/book.epub",
      expectedSha256: "a".repeat(64),
      expectedByteSize: 42,
      label: "Backend catalog source",
    });

    expect(mocks.requestBackendDownloadUrl).toHaveBeenCalledTimes(2);
    expect(mocks.downloadFile).toHaveBeenNthCalledWith(
      2,
      "https://objects.example/second",
      "file:///cache/book.epub",
      expect.objectContaining({ timeoutMs: 135_000 }),
    );
    expect(mocks.sha256BackendFile).toHaveBeenCalledWith("file:///cache/book.epub");
  });

  it("waits out the rate-limit window the gateway reported", async () => {
    vi.useFakeTimers();
    try {
      mocks.requestBackendDownloadUrl
        .mockRejectedValueOnce(
          new NarraServiceError(
            "RATE",
            "Слишком много запросов",
            undefined,
            undefined,
            "RATE",
            9_000,
          ),
        )
        .mockResolvedValueOnce("https://objects.example/after-window");
      mocks.downloadFile.mockResolvedValue(undefined);

      const download = downloadVerifiedBackendFile({
        downloadPath: "/v2/books/book-1/source/download",
        destinationPath: "file:///cache/book.epub",
        expectedSha256: "a".repeat(64),
        label: "Backend catalog source",
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(mocks.requestBackendDownloadUrl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(8_000);
      await download;
      expect(mocks.requestBackendDownloadUrl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a cover give up quickly instead of holding the queue", async () => {
    vi.useFakeTimers();
    try {
      mocks.requestBackendDownloadUrl.mockRejectedValue(new Error("cover is unavailable"));

      const download = downloadVerifiedBackendFile({
        downloadPath: "/v2/books/book-1/cover/download",
        destinationPath: "file:///cache/cover.jpg",
        expectedSha256: "a".repeat(64),
        label: "Backend catalog cover",
        ...COVER_DOWNLOAD_RETRY,
      });
      const settled = download.catch((error) => error as Error);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(await settled).toMatchObject({ message: expect.stringContaining("after 2 attempts") });
      expect(mocks.requestBackendDownloadUrl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the active native transfer without retrying", async () => {
    const controller = new AbortController();
    mocks.requestBackendDownloadUrl.mockResolvedValue("https://objects.example/hung");
    mocks.downloadFile.mockImplementation(
      async (_url: string, _destination: string, options: { signal?: AbortSignal }) => {
        await new Promise<void>((_resolve, reject) => {
          const rejectAbort = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (options.signal?.aborted) rejectAbort();
          else options.signal?.addEventListener("abort", rejectAbort, { once: true });
        });
      },
    );

    const download = downloadVerifiedBackendFile({
      downloadPath: "/v2/books/book-1/source/download",
      destinationPath: "file:///cache/book.epub",
      expectedSha256: "a".repeat(64),
      expectedByteSize: 42,
      label: "Backend catalog source",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(download).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.requestBackendDownloadUrl).toHaveBeenCalledTimes(1);
    expect(mocks.downloadFile).toHaveBeenCalledTimes(1);
  });
});
