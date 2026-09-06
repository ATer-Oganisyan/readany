import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({
  skills: vi.fn(),
  book: vi.fn(),
  memory: vi.fn(),
  agent: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock("../../../../core/src/db/database", () => ({
  getSkills: ports.skills,
  getBook: ports.book,
}));
vi.mock("../../../../core/src/ai/chat-memory", () => ({ maybeCompressThreadMemory: ports.memory }));
vi.mock("../../../../core/src/ai/skills/builtin-skills", () => ({ getBuiltinSkills: () => [] }));
vi.mock("../../../../core/src/ai/tools", () => ({ getAvailableTools: () => [] }));
vi.mock("../../../../core/src/ai/agents/reading-agent", () => ({
  streamReadingAgent: ports.agent,
}));
vi.mock("../../../../core/src/ai/message-pipeline", () => ({
  processMessages: () => ({ messages: [] }),
}));
vi.mock("../../../../core/src/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("../../../../core/src/stores/settings-store", () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) => selector({ aiConfig: {} }),
}));
vi.mock("../../../../core/src/stores/chat-store", async () => {
  const { create } = await import("zustand");
  const useChatStore = create<any>((set) => ({
    threads: [],
    bookActiveThreadIds: {},
    streamingSessions: {},
    addMessage: vi.fn(async () => {}),
    updateThreadTitle: vi.fn(async () => {}),
    startStreamingSession: (session: any) =>
      set((s: any) => ({ streamingSessions: { ...s.streamingSessions, [session.key]: session } })),
    updateStreamingSession: () => {},
    finishStreamingSession: (key: string) =>
      set((s: any) => ({
        streamingSessions: {
          ...s.streamingSessions,
          [key]: { ...s.streamingSessions[key], isStreaming: false, currentMessage: null },
        },
      })),
    failStreamingSession: vi.fn((key: string, errorMessage: string) =>
      set((s: any) => ({
        streamingSessions: { ...s.streamingSessions, [key]: { isStreaming: false, errorMessage } },
      })),
    ),
  }));
  return { useChatStore, getChatStreamingKey: (id: string) => id };
});
import { useStreamingChat } from "../../../../core/src/hooks/use-streaming-chat";
import { useChatStore } from "../../../../core/src/stores/chat-store";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("a second failure with identical text exposes a fresh error for retry recovery", async () => {
  let root!: ReactTestRenderer;
  const fail = async () => act(() => {
    useChatStore.setState({ streamingSessions: {
      "own-book": { key: "own-book", threadId: "own-thread", isStreaming: false,
        errorMessage: "Own storage unavailable" } as any,
    } });
  });
  await act(async () => { root = create(<Probe />); });
  try {
    await fail();
    const firstError = current.error;
    expect(firstError?.message).toBe("Own storage unavailable");
    await act(() => root.update(<Probe />));
    expect(current.error).toBe(firstError);
    await fail();
    expect(current.error?.message).toBe(firstError?.message);
    expect(current.error).not.toBe(firstError);
  } finally {
    await act(() => root.unmount());
  }
});

it("Stop in another book cannot cancel the first book's preparation", async () => {
  const block = deferred<any>(),
    entered = deferred<void>();
  ports.skills.mockImplementationOnce(() => {
    entered.resolve();
    return block.promise;
  });
  let root!: ReactTestRenderer, first!: Promise<void>;
  await act(async () => {
    root = create(<Probe />);
  });
  try {
    await act(async () => {
      first = current.sendMessage("own first");
      await entered.promise;
    });
    await act(async () => {
      root.update(<Probe book="other-book" />);
    });
    await act(async () => {
      current.stopStream();
    });
    expect(useChatStore.getState().streamingSessions["own-book"].isStreaming).toBe(true);
    await act(async () => {
      block.resolve([]);
      await first;
    });
    expect(ports.agent).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().streamingSessions["other-book"]).toBeUndefined();
  } finally {
    block.resolve([]);
    await act(async () => root.unmount());
    await first;
  }
});

it("Stop after streaming starts preserves the existing partial-answer abort path", async () => {
  const entered = deferred<void>(),
    block = deferred<void>();
  ports.agent.mockImplementationOnce(async function* () {
    yield { type: "token", content: "Own partial answer" };
    entered.resolve();
    await block.promise;
  });
  let root!: ReactTestRenderer, pending!: Promise<void>;
  await act(async () => {
    root = create(<Probe />);
  });
  try {
    await act(async () => {
      pending = current.sendMessage("own question");
      await entered.promise;
    });
    await act(async () => {
      current.stopStream();
      await pending;
    });
    expect(current.isStreaming).toBe(false);
    const addMessage = vi.mocked(useChatStore.getState().addMessage);
    expect(
      addMessage.mock.calls.some(
        ([, message]) => message.role === "assistant" && message.content === "Own partial answer",
      ),
    ).toBe(true);
    expect(ports.agent).toHaveBeenCalledTimes(1);
  } finally {
    block.resolve();
    await act(async () => root.unmount());
    await pending;
  }
});
let current: ReturnType<typeof useStreamingChat>;
function Probe({ book = "own-book" }: { book?: string }) {
  current = useStreamingChat({ bookId: book });
  return null;
}
beforeEach(() => {
  vi.clearAllMocks();
  ports.skills.mockResolvedValue([]);
  ports.book.mockResolvedValue(null);
  ports.memory.mockImplementation(async (thread) => thread);
  ports.agent.mockImplementation(async function* () {
    yield { type: "error", error: "own terminal" };
  });
  useChatStore.setState({
    threads: [{ id: "own-thread", title: "Own", messages: [] }] as any,
    bookActiveThreadIds: { "own-book": "own-thread" },
    streamingSessions: {},
  });
});
for (const phase of ["skills", "memory", "book"] as const) {
  for (const late of ["resolve", "reject"] as const) {
    it(`Stop settles ${phase} preparation immediately and ignores late ${late}`, async () => {
      const block = deferred<any>(),
        entered = deferred<void>();
      ports[phase].mockImplementationOnce(() => {
        entered.resolve();
        return block.promise;
      });
      let root!: ReactTestRenderer,
        first!: Promise<void>,
        settled = false;
      await act(async () => {
        root = create(<Probe />);
      });
      try {
        await act(async () => {
          first = current.sendMessage("own first").then(() => {
            settled = true;
          });
          await entered.promise;
        });
        await act(async () => {
          current.stopStream();
        });
        expect(current.isStreaming).toBe(false);
        expect(settled).toBe(true);
        expect(ports.agent).not.toHaveBeenCalled();
        const secondBlock = deferred<any>(),
          secondEntered = deferred<void>();
        ports.skills.mockImplementationOnce(() => {
          secondEntered.resolve();
          return secondBlock.promise;
        });
        let second!: Promise<void>;
        await act(async () => {
          second = current.sendMessage("own second");
          await secondEntered.promise;
        });
        await act(async () => {
          if (late === "reject") block.reject(new Error("old preparation failed"));
          else
            block.resolve(
              phase === "skills"
                ? []
                : phase === "memory"
                  ? { id: "own-thread", messages: [], memoryMessageCount: 999 }
                  : null,
            );
          await first;
        });
        expect(current.isStreaming).toBe(true);
        expect(ports.agent).not.toHaveBeenCalled();
        await act(async () => {
          secondBlock.resolve([]);
          await second;
        });
        expect(ports.agent).toHaveBeenCalledTimes(1);
      } finally {
        block.resolve(phase === "skills" ? [] : { id: "own-thread", messages: [] });
        await act(async () => {
          current.stopStream();
          root.unmount();
        });
        await first;
      }
    });
  }
}
