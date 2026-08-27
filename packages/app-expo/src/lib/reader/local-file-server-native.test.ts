import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  start: vi.fn(async () => "http://127.0.0.1:12001"),
  stop: vi.fn(async () => {}),
  instances: 0,
}));
vi.mock("expo-file-system", () => ({ File: class {}, FileMode: { ReadOnly: "r" } }));
vi.mock("@dr.pogodin/react-native-static-server", () => ({
  STATES: { ACTIVE: "active" },
  default: class {
    state = "active";
    constructor() {
      native.instances++;
    }
    start = native.start;
    stop = native.stop;
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("__DEV__", false);
  native.instances = 0;
  native.start.mockReset().mockResolvedValue("http://127.0.0.1:12001");
  native.stop.mockReset().mockResolvedValue();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("production native server lifecycle", () => {
  it("does not let a hung native stop block recovery forever", async () => {
    vi.useFakeTimers();
    const server = await import("./local-file-server");
    await server.startFileServer("/books");
    native.stop.mockImplementationOnce(() => new Promise(() => {}));
    native.start.mockResolvedValueOnce("http://127.0.0.1:12002");
    const retry = server.startFileServer("/books", { restart: true });
    await vi.advanceTimersByTimeAsync(501);
    await expect(retry).resolves.toBe("http://127.0.0.1:12002");
    expect(native.instances).toBe(2);
    await server.stopFileServer();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces native starts and honors forced retry after prewarm", async () => {
    const server = await import("./local-file-server");
    await Promise.all([server.startFileServer("/books"), server.startFileServer("/books")]);
    expect(native.instances).toBe(1);
    await server.startFileServer("/books", { restart: true });
    expect(native.instances).toBe(2);
    await server.stopFileServer();
  });
});
