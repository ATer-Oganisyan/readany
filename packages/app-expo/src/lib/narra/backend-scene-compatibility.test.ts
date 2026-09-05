import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ consumeNarraGatewayResponse: vi.fn() }));
vi.mock("./backend-book-api", async (original) => ({
  ...(await original<typeof import("./backend-book-api")>()),
  backendBookRequest: network.request,
}));

import { BackendBookError } from "./backend-book-api";
import {
  BACKEND_SCENE_DEADLINE_MS,
  requestBackendSceneAt,
  resolveBackendScene,
} from "./backend-scene";
import {
  clearBackendSceneOperationsForTests,
  consumeBackendSceneOperation,
} from "./backend-scene-operations";

const intent = { bookEditionId: "edition", markupIdentity: "v3", requestedProgress: 0.4 };
const wire = {
  status: "ready",
  scene_key: "reader-card-v1:400",
  slot_index: 1400,
  anchor_text_offset: 400,
  image_url: "https://storage.test/scene.png",
  mime_type: "image/png",
};
const ready = {
  status: "ready" as const,
  sceneKey: wire.scene_key,
  slotIndex: 1400,
  anchorTextOffset: 400,
  pollAfterMs: 250,
};

beforeEach(() => {
  network.request.mockReset();
});
afterEach(() => {
  clearBackendSceneOperationsForTests();
  vi.useRealTimers();
});

describe("scene compatibility and recovery boundaries", () => {
  it("retries without the new field only when an older gateway rejects retry_failed", async () => {
    network.request.mockImplementation(async (_path, init) => {
      if (JSON.parse(init.body).retry_failed !== undefined) {
        throw new BackendBookError(400, {
          code: "VALIDATION",
          error: "body.retry_failed: unknown field",
        });
      }
      return wire;
    });
    await expect(requestBackendSceneAt("edition", 0.4, undefined, true)).resolves.toMatchObject({
      status: "ready",
    });
    expect(network.request.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
      { progress_fraction: 0.4, retry_failed: true },
      { progress_fraction: 0.4 },
    ]);
  });

  it("does not bypass unrelated validation failures", async () => {
    network.request.mockRejectedValue(
      new BackendBookError(400, {
        code: "VALIDATION",
        error: "progress_fraction: invalid position",
      }),
    );
    await expect(requestBackendSceneAt("edition", 0.4, undefined, true)).rejects.toMatchObject({
      status: 400,
    });
    expect(network.request).toHaveBeenCalledOnce();
  });

  it("aborts the initial API call even when its transport ignores cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    network.request.mockImplementation(() => new Promise(() => {}));
    const call = requestBackendSceneAt("edition", 0.4, controller.signal, true);
    const assertion = expect(call).rejects.toMatchObject({ code: "SCENE_ABORTED" });
    controller.abort();
    await assertion;
    expect(network.request.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows retrying failed generation only on the first user request", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...ready, status: "queued" })
      .mockResolvedValueOnce({ ...ready, status: "running" })
      .mockResolvedValue(ready);
    await resolveBackendScene(intent, {
      request,
      save: async () => "file:///scene.png",
      wait: async () => {},
    });
    expect(request.mock.calls.map((call) => call[3])).toEqual([true, false, false]);
  });

  it("shares a single 30-second recovery budget between the final request and save", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...ready, status: "running" })
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(ready), 20000)));
    const failed = vi.fn();
    void resolveBackendScene(intent, {
      request,
      wait: async () => {
        vi.setSystemTime(BACKEND_SCENE_DEADLINE_MS);
      },
      save: () => new Promise(() => {}),
    }).catch(failed);
    await vi.advanceTimersByTimeAsync(30001);
    expect(failed).toHaveBeenCalledOnce();
    expect(failed.mock.calls[0]?.[0]).toMatchObject({ code: "SCENE_TIMEOUT" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("converts a synchronous operation startup error into rejection and permits retry", async () => {
    let result: Promise<string> | undefined;
    expect(() => {
      result = consumeBackendSceneOperation<string>(
        "sync-error",
        () => {
          throw new Error("startup failed");
        },
        new AbortController().signal,
      );
    }).not.toThrow();
    await expect(result).rejects.toThrow("startup failed");
    await expect(
      consumeBackendSceneOperation(
        "sync-error",
        async () => "retried",
        new AbortController().signal,
      ),
    ).resolves.toBe("retried");
  });
});
