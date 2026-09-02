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
vi.mock("react-native-tcp-socket", async () => {
  const net = await import("node:net");
  return { default: { createServer: net.createServer } };
});

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
  vi.unstubAllEnvs();
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

describe("development backend selection", () => {
  it("uses the native server in Android development clients", async () => {
    vi.stubGlobal("__DEV__", true);
    vi.stubEnv("EXPO_OS", "android");
    const server = await import("./local-file-server");

    await expect(server.startFileServer("/books")).resolves.toBe("http://127.0.0.1:12001");
    expect(native.instances).toBe(1);
    await server.stopFileServer();
  });

  it("allows the slower first Android native start to finish during prewarm", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("__DEV__", true);
    vi.stubEnv("EXPO_OS", "android");
    native.start.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve("http://127.0.0.1:12001"), 3500)),
    );
    const server = await import("./local-file-server");

    const start = server.startFileServer("/books");
    await vi.advanceTimersByTimeAsync(3501);
    await expect(start).resolves.toBe("http://127.0.0.1:12001");
    await server.stopFileServer();
  });

  it("keeps the existing TCP fallback in iOS development clients", async () => {
    vi.stubGlobal("__DEV__", true);
    vi.stubEnv("EXPO_OS", "ios");
    const server = await import("./local-file-server");

    await expect(server.startFileServer("/books")).resolves.toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(native.instances).toBe(0);
    await server.stopFileServer();
  });
});
