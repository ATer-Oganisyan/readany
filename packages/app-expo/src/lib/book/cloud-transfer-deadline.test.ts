import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  tasks: [] as Array<{
    options: {
      signal: AbortSignal;
      onProgress: (value: { bytesWritten: number; totalBytes: number }) => void;
    };
    release: ReturnType<typeof vi.fn>;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>,
}));
vi.mock("@readany/core/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("expo-clipboard", () => ({}));
vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system/legacy", () => ({}));
vi.mock("expo-network", () => ({}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-sharing", () => ({}));
vi.mock("expo-file-system", () => ({
  Directory: class {},
  Paths: {},
  File: class {
    constructor(public uri: string) {}
  },
  DownloadTask: class {
    release = vi.fn();
    promise: Promise<unknown>;
    constructor(_url: string, _file: unknown, options: (typeof native.tasks)[number]["options"]) {
      this.promise = new Promise((resolve, reject) => {
        native.tasks.push({ options, release: this.release, resolve, reject });
      });
    }
    downloadAsync() {
      return this.promise;
    }
  },
}));

import { ExpoPlatformService } from "@/lib/platform/expo-platform-service";
import { setPlatformService } from "@readany/core/services";
import { WebDavClient } from "@readany/core/sync/webdav-client";

beforeEach(() => {
  vi.useFakeTimers();
  native.tasks.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("real mobile cloud transfer deadline and cancellation", () => {
  it("preserves a timeout on React Native without AbortSignal.reason", async () => {
    const BaseController = globalThis.AbortController;
    vi.stubGlobal(
      "AbortController",
      class extends BaseController {
        constructor() {
          super();
          Object.defineProperty(this.signal, "reason", { get: () => undefined });
        }
      },
    );
    const result = new ExpoPlatformService()
      .downloadFile("http://127.0.0.1/stall", "file:///qa", {
        timeoutMs: 1000,
      })
      .then(
        () => "success",
        (error: Error) => error.name,
      );
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toBe("TimeoutError");
    expect(native.tasks[0].options.signal.aborted).toBe(true);
    expect(native.tasks[0].release).toHaveBeenCalledOnce();
  });

  it("bounds a stalled WebDAV direct download and permits the next transfer", async () => {
    setPlatformService(new ExpoPlatformService());
    const client = new WebDavClient("http://127.0.0.1:8099", "qa", "local-only");
    const result = client.getFileToPath("stall.epub", "file:///new-qa-artifact").then(
      () => "success",
      (error: Error) => error.message,
    );
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(300_001);
    expect(native.tasks[0].options.signal.aborted).toBe(true);
    expect(settled).toBe(true);
    expect(await result).toMatch(/timeout/i);
    expect(native.tasks[0].release).toHaveBeenCalledOnce();
    const retry = client.getFileToPath("01-river.epub", "file:///another-qa-artifact");
    native.tasks[1].resolve({ uri: "file:///another-qa-artifact" });
    await retry;
    expect(native.tasks[1].release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles on caller cancellation even when the native promise ignores abort", async () => {
    const service = new ExpoPlatformService();
    const controller = new AbortController();
    const progress = vi.fn();
    let settled = false;
    const result = service
      .downloadFile("http://127.0.0.1/stall", "file:///qa", {
        signal: controller.signal,
        timeoutMs: 1000,
        onProgress: progress,
      })
      .then(
        () => "success",
        (error: Error) => error.name,
      );
    void result.then(() => {
      settled = true;
    });
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(await result).toBe("AbortError");
    native.tasks[0].options.onProgress({ bytesWritten: 42, totalBytes: 100 });
    native.tasks[0].reject(new Error("late native rejection"));
    await vi.advanceTimersByTimeAsync(1);
    expect(progress).not.toHaveBeenCalled();
    expect(native.tasks[0].release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not begin a pre-cancelled native transfer", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = new ExpoPlatformService().downloadFile("http://127.0.0.1/a", "file:///qa", {
      signal: controller.signal,
    });
    let settled = false;
    void result.catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await expect(result).rejects.toHaveProperty("name", "AbortError");
    expect(native.tasks).toHaveLength(0);
  });

  it("keeps successful progress, release, and caller signal intact", async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    const result = new ExpoPlatformService().downloadFile("http://127.0.0.1/a", "file:///qa", {
      signal: controller.signal,
      timeoutMs: 1000,
      onProgress: progress,
    });
    native.tasks[0].options.onProgress({ bytesWritten: 42, totalBytes: 100 });
    native.tasks[0].resolve({ uri: "file:///qa" });
    await result;
    expect(progress).toHaveBeenCalledWith(42, 100);
    expect(controller.signal.aborted).toBe(false);
    expect(native.tasks[0].release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
