import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReaderProgressPersistence } from "./reader-progress";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("reading position survives interruptions", () => {
  it("flushes the latest page immediately instead of waiting for the five-second timer", async () => {
    const save = vi.fn(async () => {});
    const persistence = createReaderProgressPersistence(save, vi.fn());
    persistence.update(0.1, "page-1");
    await vi.advanceTimersByTimeAsync(200);
    persistence.update(0.2, "page-2");
    persistence.update(0.3, "page-3");
    expect(save).toHaveBeenCalledTimes(1);
    const flushed = persistence.flush();
    expect(save).toHaveBeenLastCalledWith({ progress: 0.3, currentCfi: "page-3" });
    await flushed;
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("leaves no old timer that could overwrite progress after the reader reopens", async () => {
    let currentCfi = "";
    const save = vi.fn(async (position) => {
      currentCfi = position.currentCfi;
    });
    const first = createReaderProgressPersistence(save, vi.fn());
    first.update(0.1, "page-1");
    first.update(0.2, "page-2");
    await first.flush();
    const reopened = createReaderProgressPersistence(save, vi.fn());
    reopened.update(0.3, "page-3");
    await vi.advanceTimersByTimeAsync(6000);
    expect(currentCfi).toBe("page-3");
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("waits for a pending database save without blocking an update in memory", async () => {
    let release!: () => void;
    let currentCfi = "";
    const persistence = createReaderProgressPersistence((position) => {
      currentCfi = position.currentCfi;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    }, vi.fn());
    persistence.update(0.5, "page-5");
    let finished = false;
    const flushed = persistence.flush().then(() => {
      finished = true;
    });
    expect(currentCfi).toBe("page-5");
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    release();
    await flushed;
    expect(finished).toBe(true);
  });

  it("reports write failure and keeps later reading progress saveable", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const persistence = createReaderProgressPersistence(save, onError);
    persistence.update(0.2, "page-2");
    await persistence.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    persistence.update(0.3, "page-3");
    await persistence.flush();
    expect(save).toHaveBeenLastCalledWith({ progress: 0.3, currentCfi: "page-3" });
  });
});
