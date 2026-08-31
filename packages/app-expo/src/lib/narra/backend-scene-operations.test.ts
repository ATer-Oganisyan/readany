import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ consumeNarraGatewayResponse: vi.fn() }));
import {
  clearBackendSceneOperationsForTests,
  consumeBackendSceneOperation,
} from "./backend-scene-operations";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(clearBackendSceneOperationsForTests);

describe("backend scene operation sharing", () => {
  it("joins parallel consumers by canonical backend id", async () => {
    const work = deferred<string>();
    const start = vi.fn(() => work.promise);
    const first = consumeBackendSceneOperation("scene", start, new AbortController().signal);
    const second = consumeBackendSceneOperation("scene", start, new AbortController().signal);
    expect(start).toHaveBeenCalledTimes(1);
    work.resolve("file:///scene.png");
    await expect(Promise.all([first, second])).resolves.toEqual([
      "file:///scene.png",
      "file:///scene.png",
    ]);
  });

  it("does not cancel shared work when only one consumer leaves", async () => {
    const work = deferred<string>();
    let sharedSignal: AbortSignal | undefined;
    const start = (signal: AbortSignal) => {
      sharedSignal = signal;
      return work.promise;
    };
    const firstController = new AbortController();
    const first = consumeBackendSceneOperation("scene", start, firstController.signal);
    const second = consumeBackendSceneOperation("scene", start, new AbortController().signal);
    firstController.abort();
    await expect(first).rejects.toThrow("SCENE_ABORTED");
    expect(sharedSignal?.aborted).toBe(false);
    work.resolve("file:///scene.png");
    await expect(second).resolves.toBe("file:///scene.png");
  });
});
