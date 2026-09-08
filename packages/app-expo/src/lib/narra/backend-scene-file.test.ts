import { beforeEach, describe, expect, it, vi } from "vitest";
const fs = vi.hoisted(() => ({
  files: new Map<string, number>(),
  download: vi.fn(),
  events: [] as string[],
}));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digestStringAsync: vi.fn(async () => "hash"),
  randomUUID: () => "unique",
}));
vi.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
    }
    get exists() {
      return fs.files.has(this.uri);
    }
    get size() {
      return fs.files.get(this.uri) ?? 0;
    }
    delete() {
      fs.events.push(`delete:${this.uri}`);
      fs.files.delete(this.uri);
    }
    async move(target: File) {
      await Promise.resolve();
      fs.files.set(target.uri, this.size);
      fs.files.delete(this.uri);
      this.uri = target.uri;
    }
    static downloadFileAsync = fs.download;
  }
  return {
    File,
    Directory: class extends File {
      create() {}
    },
    Paths: { document: "file:///documents" },
  };
});
import { saveBackendSceneFile } from "./backend-scene-file";
const intent = { bookEditionId: "edition", markupIdentity: "v3", requestedProgress: 0.3 };
const scene = {
  status: "ready" as const,
  sceneKey: "text-interval-v1:0",
  slotIndex: 0,
  anchorTextOffset: 10,
  pollAfterMs: 2000,
  imageUrl: "https://storage.test/signed",
  mimeType: "image/png" as const,
};
const destination = "file:///documents/narra-media/backend-scene-hash.png";
beforeEach(() => {
  fs.files.clear();
  fs.events = [];
  fs.download.mockReset();
});
describe("native backend scene files", () => {
  it("cancels a stalled native download after 60 seconds and releases the timer", async () => {
    vi.useFakeTimers();
    try {
      fs.download.mockImplementation(
        (_url, _file, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(new Error("AbortError")), {
              once: true,
            });
          }),
      );
      const pending = saveBackendSceneFile(intent, scene);
      const assertion = expect(pending).rejects.toThrow("AbortError");
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
      expect(fs.files.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("downloads idempotently into a temporary file, then moves; cleanup does not delete the moved file", async () => {
    fs.files.set(destination, 20);
    fs.download.mockImplementation(async (_url, file, options) => {
      expect(options).toEqual({ idempotent: true, signal: expect.any(AbortSignal) });
      expect(file.uri).not.toBe(destination);
      expect(fs.files.get(destination)).toBe(20);
      fs.files.set(file.uri, 42);
    });
    await expect(saveBackendSceneFile(intent, scene)).resolves.toBe(destination);
    expect([...fs.files]).toEqual([[destination, 42]]);
    expect(fs.events).toEqual([`delete:${destination}`]);
  });
  it.each(["empty", "missing", "partial-error"])(
    "never replaces a valid previous image with %s",
    async (mode) => {
      fs.files.set(destination, 20);
      fs.download.mockImplementation(async (_url, file) => {
        if (mode !== "missing") fs.files.set(file.uri, mode === "empty" ? 0 : 3);
        if (mode === "partial-error") throw new Error("download failed");
      });
      await expect(saveBackendSceneFile(intent, scene)).rejects.toThrow();
      expect([...fs.files]).toEqual([[destination, 20]]);
    },
  );
  it("does not publish a native download that completes after cancellation", async () => {
    const controller = new AbortController();
    fs.download.mockImplementation(async (_url, file) => {
      fs.files.set(file.uri, 42);
      controller.abort();
    });
    await expect(saveBackendSceneFile(intent, scene, controller.signal)).rejects.toThrow(
      "SCENE_ABORTED",
    );
    expect(fs.files.size).toBe(0);
  });
});
