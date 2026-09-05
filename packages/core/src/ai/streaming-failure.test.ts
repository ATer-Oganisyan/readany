import { beforeEach, expect, it, vi } from "vitest";
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
