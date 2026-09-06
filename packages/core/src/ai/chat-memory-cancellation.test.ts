import { beforeEach, expect, it, vi } from "vitest";
import type { AIConfig, Thread } from "../types";
const ports = vi.hoisted(() => ({ create: vi.fn(), invoke: vi.fn(), write: vi.fn() }));
vi.mock("./llm-provider", () => ({ createChatModel: ports.create }));
vi.mock("../db/database", () => ({ updateThreadMemory: ports.write }));
import { maybeCompressThreadMemory } from "./chat-memory";
const thread = {
  id: "own",
  messages: Array.from({ length: 7 }, (_, index) => ({
    role: "user",
    content: `Own fixture ${index}`,
  })),
} as Thread;
const config = { slidingWindowSize: 2 } as AIConfig;
beforeEach(() => {
  vi.clearAllMocks();
  ports.create.mockResolvedValue({ invoke: ports.invoke });
  ports.invoke.mockResolvedValue({ content: "Own summary" });
  ports.write.mockResolvedValue(undefined);
});
it("already cancelled memory preparation never creates a model", async () => {
  const reason = new Error("stopped");
  await expect(maybeCompressThreadMemory(thread, config, AbortSignal.abort(reason))).rejects.toBe(
    reason,
  );
  expect(ports.create).not.toHaveBeenCalled();
});
for (const phase of ["create", "invoke"] as const) {
  it(`cancelled memory ${phase} never writes late output`, async () => {
    let release!: (value: unknown) => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    ports[phase].mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const controller = new AbortController(),
      reason = new Error("stopped");
    const pending = maybeCompressThreadMemory(thread, config, controller.signal);
    await ready;
    controller.abort(reason);
    release(phase === "create" ? { invoke: ports.invoke } : { content: "Late summary" });
    await expect(pending).rejects.toBe(reason);
    expect(ports.write).not.toHaveBeenCalled();
    if (phase === "create") expect(ports.invoke).not.toHaveBeenCalled();
    else expect(ports.invoke.mock.calls[0][1].signal).toBe(controller.signal);
  });
}
it("legacy callers without a signal still persist memory", async () => {
  const result = await maybeCompressThreadMemory(thread, config);
  expect(result.memorySummary).toBe("Own summary");
  expect(ports.write).toHaveBeenCalledWith("own", "Own summary", 5);
});

it("supports native signals without throwIfAborted or reason", async () => {
  const controller = new AbortController();
  Object.defineProperty(controller.signal, "throwIfAborted", { value: undefined });
  Object.defineProperty(controller.signal, "reason", { value: undefined });
  await expect(maybeCompressThreadMemory(thread, config, controller.signal)).resolves.toMatchObject({ memorySummary: "Own summary" });
  ports.create.mockClear();
  controller.abort();
  await expect(maybeCompressThreadMemory(thread, config, controller.signal)).rejects.toThrow("Memory preparation stopped");
  expect(ports.create).not.toHaveBeenCalled();
});
