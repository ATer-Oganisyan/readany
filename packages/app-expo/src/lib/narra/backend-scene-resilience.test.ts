import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ consumeNarraGatewayResponse: vi.fn() }));

import { BACKEND_SCENE_DEADLINE_MS, resolveBackendScene } from "./backend-scene";
import {
  clearBackendSceneOperationsForTests,
  consumeBackendSceneOperation,
} from "./backend-scene-operations";

const intent = { bookEditionId: "edition", markupIdentity: "v3", requestedProgress: 0.4 };
const ready = {
  status: "ready" as const,
  sceneKey: "reader-card-v1:400",
  slotIndex: 1400,
  anchorTextOffset: 400,
  pollAfterMs: 2000,
};

afterEach(() => {
  clearBackendSceneOperationsForTests();
  vi.useRealTimers();
});

describe("scene operation lifecycle", () => {
  it("settles a hung request within the deadline and bounded recovery", async () => {
    vi.useFakeTimers();
    const failure = vi.fn();
    const request = vi.fn(() => new Promise<never>(() => {}));
    void resolveBackendScene(intent, { request, save: vi.fn() }).catch(failure);
    await vi.advanceTimersByTimeAsync(BACKEND_SCENE_DEADLINE_MS + 31_000);
    expect(failure).toHaveBeenCalledOnce();
    expect(failure.mock.calls[0]?.[0]).toMatchObject({ code: "SCENE_TIMEOUT" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["request", "save"])("cancels a non-cooperating %s without waiting for the network", async (stage) => {
    const controller = new AbortController();
    const failure = vi.fn();
    let started!: () => void;
    const active = new Promise<void>((resolve) => { started = resolve; });
    const hang = () => { started(); return new Promise<never>(() => {}); };
    void resolveBackendScene(intent, {
      request: stage === "request" ? hang : async () => ready,
      save: stage === "save" ? hang : vi.fn(),
    }, controller.signal).catch(failure);
    await active;
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failure).toHaveBeenCalledOnce();
    expect(failure.mock.calls[0]?.[0]).toMatchObject({ code: "SCENE_ABORTED" });
  });

  it("does not start shared work for a consumer that has already left", async () => {
    const controller = new AbortController();
    controller.abort();
    const start = vi.fn(async () => "unused");
    await expect(consumeBackendSceneOperation("scene", start, controller.signal)).rejects.toThrow("SCENE_ABORTED");
    expect(start).not.toHaveBeenCalled();
  });

  it("immediately starts fresh work when the last consumer cancels then returns", async () => {
    const controller = new AbortController();
    const old = consumeBackendSceneOperation("scene", () => new Promise<never>(() => {}), controller.signal);
    controller.abort();
    await expect(old).rejects.toThrow("SCENE_ABORTED");
    const start = vi.fn(async () => "fresh");
    const result = consumeBackendSceneOperation("scene", start, new AbortController().signal);
    expect(start).toHaveBeenCalledOnce();
    await expect(result).resolves.toBe("fresh");
  });
});
