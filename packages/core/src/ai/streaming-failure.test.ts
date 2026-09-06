import { beforeEach, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";
import type { StreamingOptions } from "./streaming";

const agent = vi.hoisted(() => vi.fn());
vi.mock("./agents/reading-agent", () => ({ streamReadingAgent: agent }));
vi.mock("./message-pipeline", () => ({
  processMessages: () => ({ messages: [{ role: "user", content: "Own stream fixture" }] }),
}));

import { StreamingChat } from "./streaming";

beforeEach(() => agent.mockReset());

function options(): StreamingOptions {
  return {
    thread: { id: "own-thread", messages: [] } as unknown as StreamingOptions["thread"],
    book: null, semanticContext: null, enabledSkills: [], isVectorized: false,
    aiConfig: {
      endpoints: [], activeEndpointId: "", activeModel: "", temperature: 0.7,
      maxTokens: 512, slidingWindowSize: 8,
    },
    getAvailableTools: () => [],
    onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn(), onAbort: vi.fn(),
  };
}

it.each(["error-event", "iterator-error"])(
  "partial tokens followed by %s never invoke successful completion or retry",
  async (kind) => {
    agent.mockImplementation(async function* () {
      yield { type: "token", content: "An unfinished answer" };
      if (kind === "iterator-error") throw new Error("PARSE");
      yield { type: "error", error: "PARSE" };
    });
    const chat = new StreamingChat();
    const first = options();
    await chat.stream(first);
    expect(first.onToken).toHaveBeenCalledWith("An unfinished answer");
    expect(first.onError).toHaveBeenCalledOnce();
    expect(first.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "PARSE" }));
    expect(first.onComplete).not.toHaveBeenCalled();
    expect(first.onAbort).not.toHaveBeenCalled();
    expect(agent).toHaveBeenCalledOnce();

    agent.mockImplementation(async function* () {
      yield { type: "token", content: "Complete answer." };
    });
    const second = options();
    await chat.stream(second);
    expect(agent).toHaveBeenCalledTimes(2);
    expect(second.onComplete).toHaveBeenCalledWith("Complete answer.", undefined);
    expect(second.onError).not.toHaveBeenCalled();
  },
);

it.each(["complete", "error"])("releases per-token abort listeners after %s", async (ending) => {
  let signal: AbortSignal | undefined;
  let peak = 0;
  agent.mockImplementation(async function* (config: { signal: AbortSignal }) {
    signal = config.signal;
    for (let index = 0; index < 40; index++) {
      peak = Math.max(peak, getEventListeners(signal, "abort").length);
      yield { type: "token", content: "x" };
    }
    if (ending === "error") throw new Error("PARSE");
  });
  await new StreamingChat().stream(options());
  expect(signal).toBeDefined();
  expect(getEventListeners(signal!, "abort")).toHaveLength(0);
  expect(peak).toBeLessThanOrEqual(1);
});

it("aborts a pending iterator without retaining cancellation listeners", async () => {
  let signal: AbortSignal | undefined;
  let reachedPending!: () => void;
  const pending = new Promise<void>(resolve => { reachedPending = resolve; });
  agent.mockImplementation(async function* (config: { signal: AbortSignal }) {
    signal = config.signal;
    yield { type: "token", content: "partial" };
    reachedPending();
    await new Promise(() => {});
  });
  const chat = new StreamingChat();
  const callbacks = options();
  const run = chat.stream(callbacks);
  await pending;
  chat.abort();
  await run;
  expect(callbacks.onAbort).toHaveBeenCalledOnce();
  expect(callbacks.onComplete).not.toHaveBeenCalled();
  expect(callbacks.onError).not.toHaveBeenCalled();
  expect(getEventListeners(signal!, "abort")).toHaveLength(0);
});
