import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "chat-request" }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import { completeNarraChat } from "./narra-chat";
import { setNarraGatewayAdapter } from "./narra-gateway-fetch";

const input = { messages: [{ role: "user" as const, content: "Привет" }] };

describe("character chat complete-response lifetime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    setNarraGatewayAdapter(null);
    vi.useRealTimers();
  });

  it.each(["headers", "body"])("times out stalled %s and allows the next send", async (stage) => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"text":"'));
        },
        cancel,
      }),
    );
    let signal: AbortSignal | null | undefined;
    setNarraGatewayAdapter((_path, init) => {
      signal = init.signal;
      return stage === "headers" ? new Promise<Response>(() => {}) : Promise.resolve(response);
    });
    let outcome: unknown;
    const pending = completeNarraChat(input).then(
      (value) => {
        outcome = value;
      },
      (error) => {
        outcome = error;
      },
    );
    await vi.advanceTimersByTimeAsync(60_001);
    expect(outcome).toMatchObject({ code: "TIMEOUT" });
    await pending;
    expect(signal?.aborted).toBe(true);
    if (stage === "body") expect(cancel).toHaveBeenCalledOnce();
    setNarraGatewayAdapter(async () => new Response(JSON.stringify({ text: "Здравствуй!" })));
    await expect(completeNarraChat(input)).resolves.toBe("Здравствуй!");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels an incomplete response without waiting for the deadline", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    setNarraGatewayAdapter(async () => new Response(new ReadableStream({ cancel })));
    let outcome: unknown;
    const request = { ...input, signal: controller.signal };
    const pending = completeNarraChat(request).catch((error) => {
      outcome = error;
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toMatchObject({ name: "AbortError" });
    await pending;
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a completed empty answer as a terminal failure", async () => {
    setNarraGatewayAdapter(async () => new Response(JSON.stringify({ text: " " })));
    await expect(completeNarraChat(input)).rejects.toMatchObject({ code: "SERVICE" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
