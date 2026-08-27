import { afterEach, describe, expect, it, vi } from "vitest";
import { createReaderHostManager, withTimeout } from "./reader-host-manager";
import { isReaderTransportError } from "./reader-recovery";

function harness() {
  let port = 1000;
  const live = new Set<string>();
  const start = vi.fn(async () => {
    const url = `http://127.0.0.1:${++port}`;
    live.add(url);
    return url;
  });
  const probe = vi.fn(async (url: string) => live.has(url));
  const fonts = vi.fn(async (url: string) => `font: ${url}`);
  const recovered = vi.fn();
  return {
    live,
    start,
    probe,
    fonts,
    recovered,
    host: createReaderHostManager({ start, probe, fonts, recovered }),
  };
}

afterEach(() => vi.useRealTimers());

describe("reader host recovery", () => {
  it("checks the server again on each book open instead of caching success forever", async () => {
    const h = harness();
    const first = await h.host.prepare();
    expect(await h.host.prepare()).toEqual(first);
    expect(h.probe).toHaveBeenCalledTimes(2);
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it("recovers a stopped server and regenerates font URLs without restarting the app", async () => {
    const h = harness();
    const first = await h.host.prepare();
    h.live.clear();
    const next = await h.host.prepare();
    expect(next.serverUrl).not.toBe(first.serverUrl);
    expect(next.fontFaceCSS).toContain(next.serverUrl);
    expect(h.start).toHaveBeenLastCalledWith(true, false);
    expect(h.recovered).toHaveBeenCalledTimes(1);
  });

  it("manual retry forces a fresh server even if the native probe is healthy", async () => {
    const h = harness();
    const first = await h.host.prepare();
    expect((await h.host.prepare(true)).serverUrl).not.toBe(first.serverUrl);
  });

  it("serializes concurrent prewarm, opening and retry without losing the forced restart", async () => {
    const h = harness();
    const [warm, retry, open] = await Promise.all([
      h.host.prepare(),
      h.host.prepare(true),
      h.host.prepare(),
    ]);
    expect(warm.serverUrl).not.toBe(retry.serverUrl);
    expect(retry).toEqual(open);
    expect(h.start).toHaveBeenCalledTimes(2);
  });

  it("falls back to TCP when a started native server does not respond", async () => {
    const h = harness();
    h.probe.mockResolvedValueOnce(false);
    await h.host.prepare();
    expect(h.start.mock.calls).toEqual([
      [false, false],
      [true, true],
    ]);
  });

  it("stops after two failed probes and permits the next user retry", async () => {
    const h = harness();
    h.probe.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await expect(h.host.prepare()).rejects.toThrow("unavailable");
    expect(h.start).toHaveBeenCalledTimes(2);
    await expect(h.host.prepare()).resolves.toHaveProperty("serverUrl");
  });

  it("does not poison the queue after a start or font error", async () => {
    const h = harness();
    h.fonts.mockRejectedValueOnce(new Error("font staging failed"));
    await expect(h.host.prepare()).rejects.toThrow("font staging");
    await expect(h.host.prepare()).resolves.toHaveProperty("fontFaceCSS");
  });

  it("bounds a hung operation and clears successful deadlines", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 500);
    const rejection = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
    await expect(withTimeout(Promise.resolve("ready"), 500)).resolves.toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not automatically restart for a corrupt EPUB", () => {
    expect(
      isReaderTransportError("TypeError: Load failed (http://127.0.0.1:123/books/a.epub)"),
    ).toBe(true);
    expect(isReaderTransportError("Failed to fetch")).toBe(true);
    expect(isReaderTransportError("Invalid ZIP central directory")).toBe(false);
  });
});
