import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  write: vi.fn(async (_path: string, _text: string) => {}),
  move: vi.fn(async (_paths: { from: string; to: string }) => {}),
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: vi.fn(async () => ({ exists: true })),
  makeDirectoryAsync: vi.fn(async () => {}),
  readAsStringAsync: vi.fn(async (path: string) => {
    if (!disk.files.has(path)) throw new Error("ENOENT");
    return disk.files.get(path);
  }),
  writeAsStringAsync: disk.write,
  moveAsync: disk.move,
}));
vi.mock("expo-secure-store", () => ({}));

const path = "file:///docs/readany-store/test.json";
const tick = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  disk.files.clear();
  disk.write.mockReset().mockImplementation(async (path, text) => {
    disk.files.set(path, text);
  });
  disk.move.mockReset().mockImplementation(async ({ from, to }) => {
    const text = disk.files.get(from);
    if (text === undefined) throw new Error("ENOENT");
    disk.files.set(to, text);
    disk.files.delete(from);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("durable mobile stores", () => {
  it("hydrates valid data and keeps store actions", async () => {
    disk.files.set(path, JSON.stringify({ count: 7 }));
    const { withPersist, flushAllWrites } = await import("./persist");
    const store = createStore(
      withPersist<{
        count: number;
        _hasHydrated: boolean;
        increment(): void;
      }>("test", (set) => ({
        count: 0,
        _hasHydrated: false,
        increment: () => set((state: { count: number }) => ({ count: state.count + 1 })),
      })),
    );
    await tick();
    expect(store.getState()._hasHydrated).toBe(true);
    store.getState().increment();
    await flushAllWrites();
    expect(JSON.parse(disk.files.get(path) ?? "null")).toMatchObject({ count: 8 });
  });

  it("quarantines malformed JSON without preventing the app from opening", async () => {
    disk.files.set(path, "{broken");
    const { withPersist } = await import("./persist");
    const store = createStore(withPersist("test", () => ({ count: 0, _hasHydrated: false })));
    await tick();
    expect(store.getState()).toMatchObject({ count: 0, _hasHydrated: true });
    expect(disk.move).toHaveBeenCalledTimes(1);
    expect([...disk.files.values()]).toContain("{broken");
  });

  it("finishes hydration after a migration rejects an old snapshot", async () => {
    disk.files.set(path, JSON.stringify({ count: 3 }));
    const { withPersist } = await import("./persist");
    const store = createStore(
      withPersist(
        "test",
        () => ({ count: 0, _hasHydrated: false }),
        undefined,
        () => {
          throw new Error("old snapshot has no aiConfig");
        },
      ),
    );
    await tick();
    expect(store.getState()).toMatchObject({ count: 0, _hasHydrated: true });
    expect(disk.move).toHaveBeenCalledTimes(1);
  });

  it("an older slow write cannot overwrite a newer flushed chat or progress snapshot", async () => {
    const { debouncedSave, flushAllWrites } = await import("./persist");
    let release!: () => void;
    disk.write.mockImplementationOnce(async (path, text) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      disk.files.set(path, text);
    });
    debouncedSave("test", { count: 1 });
    await vi.advanceTimersByTimeAsync(500);
    debouncedSave("test", { count: 2 });
    const flush = flushAllWrites();
    await tick();
    release();
    await flush;
    await tick();
    expect(JSON.parse(disk.files.get(path) ?? "null")).toEqual({ count: 2 });
  });

  it("flushes immediately and waits for all stores while keeping unrelated writes parallel", async () => {
    const { debouncedSave, flushAllWrites } = await import("./persist");
    const released: Array<() => void> = [];
    disk.write.mockImplementation(async (path, text) => {
      await new Promise<void>((resolve) => released.push(resolve));
      disk.files.set(path, text);
    });
    debouncedSave("test", { count: 1 });
    debouncedSave("chat", { messages: ["hello"] });
    let flushed = false;
    const flush = flushAllWrites().then(() => {
      flushed = true;
    });
    await tick();
    expect(released).toHaveLength(2);
    expect(flushed).toBe(false);
    for (const release of released) release();
    await flush;
    expect(disk.files.size).toBe(2);
  });

  it("continues saving after a filesystem write fails", async () => {
    const { debouncedSave, flushAllWrites } = await import("./persist");
    disk.write.mockRejectedValueOnce(new Error("disk unavailable"));
    debouncedSave("test", { count: 1 });
    await flushAllWrites();
    debouncedSave("test", { count: 2 });
    await flushAllWrites();
    expect(JSON.parse(disk.files.get(path) ?? "null")).toEqual({ count: 2 });
  });
});
