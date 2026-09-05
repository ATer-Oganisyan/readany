import { afterEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("expo/fetch", () => ({ fetch: request }));
vi.mock("@/config/bundled-ai", () => ({
  hasBundledOpenRouterKey: true,
  getBundledApiKey: () => "fixture",
}));
import { fetchGrokSpeechAudio } from "./grok-speech";
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
it("does not fetch after pre-abort", async () => {
  const controller = new AbortController();
  controller.abort();
  request.mockResolvedValue(new Response(new Uint8Array([1])));
  await expect(
    fetchGrokSpeechAudio("test", "Che", { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(request).not.toHaveBeenCalled();
});
it("bounds headers even when native fetch ignores abort", async () => {
  vi.useFakeTimers();
  request.mockReturnValue(new Promise(() => {}));
  const outcome = fetchGrokSpeechAudio("test", "Che").catch((error) => error);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await outcome).toMatchObject({ code: "TIMEOUT" });
  expect(request).toHaveBeenCalledTimes(1);
});
it("bounds a stalled stream and cancels its reader", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  request.mockResolvedValue(
    new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel })),
  );
  const outcome = fetchGrokSpeechAudio("test", "Che").catch((error) => error);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await outcome).toMatchObject({ code: "TIMEOUT" });
  expect(cancel).toHaveBeenCalled();
});
it("aborts retry backoff immediately without a second request", async () => {
  vi.useFakeTimers();
  request.mockResolvedValue(new Response("private book text", { status: 503 }));
  const controller = new AbortController();
  const outcome = fetchGrokSpeechAudio("test", "Che", { signal: controller.signal }).catch(
    (error) => error,
  );
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  expect(await outcome).toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(request).toHaveBeenCalledTimes(1);
});
it("does not consume or expose provider error bodies", async () => {
  const response = new Response("secret source", { status: 401 });
  const read = vi.spyOn(response, "text");
  request.mockResolvedValue(response);
  const error = await fetchGrokSpeechAudio("test", "Che").catch((error) => error);
  expect(read).not.toHaveBeenCalled();
  expect(JSON.stringify(error)).not.toContain("secret source");
});
it("rejects oversized streamed audio", async () => {
  vi.useFakeTimers();
  request.mockImplementation(() =>
    Promise.resolve(new Response(new Uint8Array(16 * 1024 * 1024 + 1))),
  );
  const outcome = fetchGrokSpeechAudio("test", "Che").catch((error) => error);
  await vi.runAllTimersAsync();
  expect((await outcome) instanceof Error).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  ["application/json", new TextEncoder().encode('{"error":"private source"}')],
  ["text/html", new TextEncoder().encode("<html>secret</html>")],
  ["audio/mpeg", new TextEncoder().encode("not MP3")],
  ["audio/mpeg", new Uint8Array()],
])("rejects malformed %s audio without a paid retry", async (mime, bytes) => {
  request.mockResolvedValue(new Response(bytes, { headers: { "content-type": mime } }));
  await expect(fetchGrokSpeechAudio("test", "Che")).rejects.toMatchObject({ code: "REQUEST" });
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  ["audio/mpeg", new Uint8Array([0xff, 0xfb, 0x90, 0])],
  ["application/octet-stream", new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0])],
])("accepts %s with an MP3 signature", async (mime, bytes) => {
  request.mockResolvedValue(new Response(bytes, { headers: { "content-type": mime } }));
  await expect(fetchGrokSpeechAudio("test", "Che")).resolves.toEqual(bytes);
});

it("cancels a response that arrives after its caller left", async () => {
  let respond!: (response: Response) => void;
  request.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  const controller = new AbortController();
  const outcome = fetchGrokSpeechAudio("test", "Che", { signal: controller.signal }).catch(
    (error) => error,
  );
  controller.abort();
  expect(await outcome).toMatchObject({ name: "AbortError" });
  const cancel = vi.fn();
  respond(new Response(new ReadableStream({ cancel })));
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
});

it("rejects declared oversized bodies without reading or retrying", async () => {
  const cancel = vi.fn();
  request.mockResolvedValue(
    new Response(new ReadableStream({ cancel }), {
      headers: { "content-length": String(16 * 1024 * 1024 + 1) },
    }),
  );
  await expect(fetchGrokSpeechAudio("test", "Che")).rejects.toMatchObject({ code: "REQUEST" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
});
