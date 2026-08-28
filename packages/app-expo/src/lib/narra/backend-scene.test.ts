import { describe, expect, it, vi } from "vitest";
const network = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ consumeNarraGatewayResponse: vi.fn() }));
vi.mock("./backend-book-api", async (original) => ({
  ...(await original<typeof import("./backend-book-api")>()),
  backendBookRequest: network.request,
}));
import { BackendBookError } from "./backend-book-api";
import {
  type BackendSceneSnapshot,
  parseBackendScene,
  requestBackendSceneAt,
  resolveBackendScene,
  waitForScenePoll,
} from "./backend-scene";

const intent = { bookEditionId: "edition", markupIdentity: "v3", requestedProgress: 0.385 };
const wire = (status = "ready") => ({
  status,
  scene_key: "text-interval-v1:6",
  slot_index: 6,
  anchor_text_offset: 39000,
  image_url: "https://storage.test/fresh",
  mime_type: "image/png",
});
const snapshot = (status = "ready"): BackendSceneSnapshot => parseBackendScene(wire(status));
function clock() {
  let time = 0;
  return {
    now: () => time,
    wait: vi.fn(async (ms: number) => {
      time += ms;
    }),
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("backend scene contract", () => {
  it("sends only the captured fraction using the shared authenticated API", async () => {
    network.request.mockResolvedValue(wire());
    const signal = new AbortController().signal;
    await requestBackendSceneAt("edition/id", 0.385, signal);
    expect(network.request).toHaveBeenLastCalledWith(
      "/v2/books/edition%2Fid/scenes/at",
      expect.objectContaining({ method: "POST", body: '{"progress_fraction":0.385}', signal }),
    );
    for (const value of [-1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])
      await expect(requestBackendSceneAt("edition", value)).rejects.toThrow(
        "SCENE_INVALID_POSITION",
      );
  });
  it("validates status, slot and assets; clamps the poll interval", () => {
    expect(parseBackendScene({ ...wire("queued"), poll_after_ms: 1 }).pollAfterMs).toBe(250);
    expect(parseBackendScene(wire("running")).pollAfterMs).toBe(2000);
    expect(() => parseBackendScene({ status: "failed" })).toThrow("SCENE_FAILED");
    expect(() => parseBackendScene({ ...wire(), slot_index: 0.1 })).toThrow(
      "SCENE_INVALID_RESPONSE",
    );
    expect(() => parseBackendScene({ ...wire(), image_url: "file:///private" })).toThrow(
      "SCENE_INVALID_ASSET",
    );
  });
  it("handles immediate ready and returns only after local saving", async () => {
    const events: string[] = [];
    const result = await resolveBackendScene(intent, {
      request: async () => {
        events.push("request");
        return snapshot();
      },
      save: async () => {
        events.push("saved");
        return "file:///saved.png";
      },
    });
    expect(events).toEqual(["request", "saved"]);
    expect(result.imageUri).toBe("file:///saved.png");
  });
  it("waits for a 132-second job, always polling the original fraction despite paging", async () => {
    const time = clock();
    const mutable = { ...intent };
    const request = vi.fn(async () => {
      mutable.requestedProgress = 0.9;
      return snapshot(time.now() >= 132000 ? "ready" : time.now() ? "running" : "queued");
    });
    await resolveBackendScene(mutable, { ...time, request, save: async () => "file:///scene.png" });
    expect(time.now()).toBe(132000);
    expect(request).toHaveBeenCalledTimes(67);
    expect(request.mock.calls.every((args) => (args as unknown[])[1] === 0.385)).toBe(true);
  });
  it("re-POSTs for a new signed URL after a failed download", async () => {
    const time = clock();
    let calls = 0;
    const request = vi.fn(async () => ({
      ...snapshot(),
      imageUrl: `https://storage.test/${++calls}`,
    }));
    const save = vi.fn(async (scene: BackendSceneSnapshot) => {
      if (calls === 1) throw new Error("expired URL");
      expect(scene.imageUrl).toBe("https://storage.test/2");
      return "file:///saved.png";
    });
    await resolveBackendScene(intent, { ...time, request, save });
    expect(save).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("recovers network/5xx/auth errors and keeps the same slot", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network"))
      .mockRejectedValueOnce(new BackendBookError(503, {}))
      .mockRejectedValueOnce(new BackendBookError(401, {}))
      .mockResolvedValue(snapshot());
    await resolveBackendScene(intent, {
      ...clock(),
      request,
      save: async () => "file:///ready.png",
    });
    expect(request).toHaveBeenCalledTimes(4);
  });
  it.each([400, 404, 409, 422])("fails immediately on permanent HTTP %i", async (status) => {
    const request = vi.fn(async () => {
      throw new BackendBookError(status, {});
    });
    const time = clock();
    await expect(
      resolveBackendScene(intent, { ...time, request, save: vi.fn() }),
    ).rejects.toMatchObject({ status });
    expect(time.wait).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not convert failed into timeout or accept a changed slot", async () => {
    const time = clock();
    await expect(
      resolveBackendScene(intent, {
        ...time,
        request: async () => ({ ...snapshot(), status: "failed" }),
        save: vi.fn(),
      }),
    ).rejects.toThrow("SCENE_FAILED");
    await expect(
      resolveBackendScene(
        { ...intent, sceneKey: "text-interval-v1:2" },
        { ...time, request: async () => snapshot(), save: vi.fn() },
      ),
    ).rejects.toThrow("SCENE_SLOT_CHANGED");
    expect(time.wait).not.toHaveBeenCalled();
  });
  it("makes exactly one final recovery after background exceeds the deadline", async () => {
    const time = clock();
    const trace = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValueOnce(snapshot("running"))
      .mockResolvedValue(snapshot());
    await resolveBackendScene(intent, {
      ...time,
      wait: async () => time.advance(600000),
      request,
      save: async () => "file:///ready.png",
      trace,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(trace).toHaveBeenCalledWith("recovery", 2);
  });
  it("stops after the final pending recovery and preserves the retry intent", async () => {
    const time = clock();
    const request = vi.fn(async () => snapshot("queued"));
    await expect(
      resolveBackendScene(intent, {
        ...time,
        wait: async () => time.advance(600000),
        request,
        save: vi.fn(),
      }),
    ).rejects.toThrow("SCENE_TIMEOUT");
    expect(request).toHaveBeenCalledTimes(2);
    expect(intent.requestedProgress).toBe(0.385);
  });
  it("aborts a waiting action without another request or timer leak", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const pending = waitForScenePoll(2000, controller.signal);
      const assertion = expect(pending).rejects.toThrow("SCENE_ABORTED");
      controller.abort();
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
