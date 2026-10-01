import type { CitationPart, MessageV2 } from "@readany/core/types/message";
import { Fragment, createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

const wordCommits = vi.hoisted(() => [] as { text: string; animate?: boolean }[]);
vi.mock("./streaming-words", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./streaming-words")>();
  const { useLayoutEffect } = await import("react");
  return {
    StreamingWords: (props: React.ComponentProps<typeof actual.StreamingWords>) => {
      useLayoutEffect(() => {
        wordCommits.push({ text: props.text, animate: props.animate });
      });
      return createElement(actual.StreamingWords, props);
    },
  };
});

vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Platform: { OS: "ios" },
  StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock("react-native-reanimated", async () => {
  const { useRef } = await import("react");
  return {
    default: { Text: "AnimatedText", View: "AnimatedView" },
    useSharedValue: (value: number) => useRef({ value }).current,
    useAnimatedStyle: (style: () => unknown) => style(),
    withTiming: vi.fn((value: number) => value),
    Easing: { bezier: (...curve: number[]) => curve },
    ReduceMotion: { System: "system" },
    cubicBezier: () => "ease-out",
    useReducedMotion: () => false,
  };
});
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("react-native-keyboard-controller", () => ({ useKeyboardHandler: vi.fn() }));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("expo-linear-gradient", () => ({ LinearGradient: "Gradient" }));
vi.mock("./narra-keyboard-chat-scroll-view", () => ({ NarraKeyboardChatScrollView: "ScrollView" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/styles/theme", () => ({
  bodyTypography: { fontSize: 18, fontFamily: "Regular" },
  fontFamily: { regular: "Regular" },
  useTheme: () => ({ colors: { foreground: "#111", primaryForeground: "#fff" }, isDark: false }),
  withOpacity: () => "transparent",
}));
vi.mock("panelui-native", () => ({
  Message: Object.assign(
    ({ children }: { children: React.ReactNode }) => createElement("Message", {}, children),
    { Content: "MessageContent", Bubble: "Bubble" },
  ),
  MessageScroller: Object.assign(({ children }: { children: React.ReactNode }) => children, {
    List: ({
      data,
      renderItem,
    }: { data: { messageId: string }[]; renderItem: (arg: unknown) => React.ReactNode }) =>
      data.map((item) => createElement(Fragment, { key: item.messageId }, renderItem({ item }))),
    Button: "ScrollButton",
  }),
  Shimmer: "Shimmer",
  useMessageScroller: () => ({ scrollToEnd: vi.fn(), scrollToMessage: vi.fn() }),
}));

import { NarraChatTranscript } from "./narra-chat-transcript";
import { StreamingWords } from "./streaming-words";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
afterEach(() => {
  if (tree) act(() => tree.unmount());
  wordCommits.length = 0;
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function message(id: string, role: "user" | "assistant", text: string): MessageV2 {
  return {
    id,
    role,
    threadId: "thread",
    createdAt: 1,
    parts: [
      { id: `${id}-text`, type: "text", text, status: "completed", createdAt: 1, updatedAt: 1 },
    ],
  };
}
const renderText = (item: MessageV2) =>
  item.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
const transcript = (messages: MessageV2[], inset = 0) => (
  <NarraChatTranscript
    locale="ru"
    messages={messages}
    renderText={renderText}
    baseBottomInset={inset}
  />
);
const nodes = (name: string) => tree.root.findAll((node) => String(node.type) === name);

describe("incoming chat answers", () => {
  it("fades and scales only a new outgoing bubble with cover timing and never replays it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 0));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    const { withTiming } = await import("react-native-reanimated");
    const history = message("history", "user", "История");
    const sent = message("sent", "user", "Новое сообщение");
    act(() => {
      tree = create(transcript([history], 300));
    });
    expect(nodes("AnimatedView")[0].props.style.transform[0].scale).toBe(1);
    expect(nodes("AnimatedView")[0].props.style.opacity).toBe(1);
    expect(withTiming).not.toHaveBeenCalled();
    act(() => {
      tree.update(transcript([history, sent], 300));
    });
    expect(nodes("AnimatedView").map((node) => node.props.style.transform[0].scale)).toEqual([
      1, 0.5,
    ]);
    expect(nodes("AnimatedView").map((node) => node.props.style.opacity)).toEqual([1, 0]);
    expect(withTiming).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(withTiming).toHaveBeenCalledExactlyOnceWith(1, {
      duration: 150,
      easing: [0.33, 1, 0.68, 1],
      reduceMotion: "system",
    });
    act(() => {
      tree.update(transcript([history, sent], 300));
    });
    expect(nodes("AnimatedView").every((node) => node.props.style.transform[0].scale === 1)).toBe(
      true,
    );
    expect(withTiming).toHaveBeenCalledTimes(1);
    expect(nodes("AnimatedView").every((node) => node.props.style.opacity === 1)).toBe(true);
    // Virtualized rows can unmount while reading history, then mount again.
    act(() => {
      tree.update(transcript([history], 300));
    });
    act(() => {
      tree.update(transcript([history, sent, message("answer", "assistant", "Ответ")], 300));
    });
    expect(nodes("AnimatedView").every((node) => node.props.style.transform[0].scale === 1)).toBe(
      true,
    );
    expect(withTiming).toHaveBeenCalledTimes(1);
    expect(
      wordCommits
        .filter((commit) => commit.text === "Новое сообщение")
        .every((commit) => commit.animate === false),
    ).toBe(true);
  });
  it("reveals a sent row mounted after another send, without waiting for its scroll notification", async () => {
    vi.useFakeTimers();
    const { withTiming } = await import("react-native-reanimated");
    const history = message("history", "assistant", "История");
    const first = message("first", "user", "Первое");
    const second = message("second", "user", "Второе");
    act(() => {
      tree = create(transcript([history]));
    });
    act(() => {
      tree.update(transcript([history, first]));
    });
    // FlatList unmounts the row before its reveal timer runs.
    act(() => {
      tree.update(transcript([history]));
    });
    act(() => {
      tree.update(transcript([history, second]));
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      tree.update(transcript([history, first, second]));
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      tree.update(transcript([history, first, second]));
    });
    expect(nodes("AnimatedView").every((node) => node.props.style.opacity === 1)).toBe(true);
    expect(withTiming).toHaveBeenCalledTimes(2);
  });
  it("animates the first greeting from its first committed frame", () => {
    act(() => {
      tree = create(transcript([]));
    });
    const greeting = message("greeting", "assistant", "Добрый день");
    act(() => {
      tree.update(transcript([greeting]));
    });
    expect(wordCommits.filter((commit) => commit.text === "Добрый день")).toEqual([
      { text: "Добрый день", animate: true },
    ]);
  });

  it("keeps the word queue when the surrounding chat rerenders", () => {
    const text = "Один и тот же ответ для Нары и персонажа";
    act(() => {
      tree = create(<StreamingWords color="#111" text={text} />);
    });
    const words = nodes("AnimatedText");
    const delays = words.map((word) => word.props.style.at(-1).animationDelay);
    expect(words.every((word) => word.props.style.at(-1).opacity === 0)).toBe(true);
    act(() => {
      tree.update(<StreamingWords color="#111" text={text} />);
    });
    expect(nodes("AnimatedText")[0]).toBe(words[0]);
    expect(nodes("AnimatedText").map((word) => word.props.style.at(-1).animationDelay)).toEqual(
      delays,
    );
    expect(delays.at(-1)).toBeGreaterThan(0);
  });

  it("animates a newly received full answer without replaying history or user messages", () => {
    const history = message("history", "assistant", "Прошлый ответ");
    const user = message("user", "user", "Привет");
    act(() => {
      tree = create(transcript([history, user]));
    });
    expect(nodes("AnimatedText")).toHaveLength(0);
    act(() => {
      tree.update(transcript([history, user, message("answer", "assistant", "Добрый день")]));
    });
    const words = nodes("AnimatedText");
    expect(words.map((word) => word.props.children)).toEqual(["Добрый ", "день "]);
    expect(words[1].props.style.at(-1).animationDelay).toBeGreaterThan(
      words[0].props.style.at(-1).animationDelay,
    );
    expect(words[0].props.style[0].fontWeight).toBe("400");
  });

  it("does not draw empty saved answers or messages containing only internal reasoning", () => {
    const hidden = message("hidden", "assistant", "");
    hidden.parts = [
      {
        id: "reasoning",
        type: "reasoning",
        text: "Thinking",
        status: "completed",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    act(() => {
      tree = create(transcript([message("empty", "assistant", ""), hidden]));
    });
    expect(nodes("Bubble")).toHaveLength(0);
    expect(nodes("Text")).toHaveLength(0);
  });

  it("keeps citations pressable in both stored and animated regular text", () => {
    const citation = {
      id: "source",
      type: "citation",
      citationIndex: 1,
      cfi: "epubcfi(/6/2)",
      bookId: "book",
      chapterTitle: "Глава",
      chapterIndex: 0,
      text: "Цитата",
      status: "completed",
      createdAt: 1,
      updatedAt: 1,
    } as CitationPart;
    const answer = message("answer", "assistant", "Ответ [1].");
    answer.parts.push(citation);
    const press = vi.fn();
    const screen = (messages: MessageV2[]) => (
      <NarraChatTranscript
        locale="ru"
        messages={messages}
        renderText={renderText}
        onCitationClick={press}
      />
    );
    act(() => {
      tree = create(screen([answer]));
    });
    act(() =>
      nodes("Text")
        .find((node) => node.props.onPress)
        ?.props.onPress(),
    );
    expect(press).toHaveBeenLastCalledWith(citation);
    const incoming = { ...answer, id: "next" };
    act(() => tree.update(screen([answer, incoming])));
    act(() =>
      nodes("AnimatedText")
        .find((node) => node.props.onPress)
        ?.props.onPress(),
    );
    expect(press).toHaveBeenCalledTimes(2);
  });
});
