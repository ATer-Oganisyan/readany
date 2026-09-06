import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadVerifiedBackendFile } from "./backend-file-download";

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
  afterEach(() => vi.useRealTimers());
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

  it("does not complete an import cancelled while its checksum is being verified", async () => {
    const controller = new AbortController();
    let finishHash!: (hash: string) => void;
    mocks.requestBackendDownloadUrl.mockResolvedValue("https://objects.example/book");
    mocks.downloadFile.mockResolvedValue(undefined);
    mocks.sha256BackendFile.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishHash = resolve;
        }),
    );
    const download = downloadVerifiedBackendFile({
      downloadPath: "/v2/books/book-1/source/download",
      destinationPath: "file:///cache/book.epub",
      expectedSha256: "a".repeat(64),
      label: "Backend catalog source",
      signal: controller.signal,
    });
    const outcome = download.then(
      () => "success",
      (error: Error) => error.name,
    );
    await vi.waitFor(() => expect(finishHash).toBeTypeOf("function"));
    controller.abort();
    finishHash("a".repeat(64));
    expect(await outcome).toBe("AbortError");
    expect(mocks.requestBackendDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it.each(["download", "checksum"])(
    "settles an uncooperative native %s at the attempt deadline without overlapping writers",
    async (stage) => {
      vi.useFakeTimers();
      mocks.requestBackendDownloadUrl.mockResolvedValue("https://objects.example/book");
      mocks.downloadFile.mockResolvedValue(undefined);
      if (stage === "download")
        mocks.downloadFile.mockImplementationOnce(() => new Promise(() => {}));
      else mocks.sha256BackendFile.mockImplementationOnce(() => new Promise(() => {}));
      let outcome = "pending";
      void downloadVerifiedBackendFile({
        downloadPath: "/v2/books/book-1/source/download",
        destinationPath: "file:///cache/book.epub",
        expectedSha256: "a".repeat(64),
        label: "Backend catalog source",
        attemptTimeoutMs: 20,
      }).then(
        () => {
          outcome = "success";
        },
        (error: { code: string }) => {
          outcome = error.code;
        },
      );
      await vi.advanceTimersByTimeAsync(20);
      expect(outcome).toBe("TIMEOUT");
      expect(mocks.requestBackendDownloadUrl).toHaveBeenCalledOnce();
      expect(mocks.downloadFile).toHaveBeenCalledOnce();
      expect(mocks.deleteAsync).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
