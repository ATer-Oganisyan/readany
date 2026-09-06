import { type ComponentProps, StrictMode } from "react";
import { type ReactTestInstance, type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  mode: "finished" as "finished" | "interrupted" | "missing",
  dropFrames: false,
  animations: [] as Array<{
    complete: (finished: boolean) => void;
    notify: (finished: boolean) => void;
    stop: () => void;
  }>,
  retry: vi.fn(async () => {}),
  reduceMotion: false,
}));
vi.mock("react-native", () => {
  class Value {
    current: number;
    stop: (() => void) | undefined;
    constructor(value: number) {
      this.current = value;
    }
    setValue(value: number) {
      this.current = value;
    }
    stopAnimation() {
      this.stop?.();
      this.stop = undefined;
    }
  }
  return {
    Platform: { OS: "ios" },
    View: "View",
    ScrollView: "ScrollView",
    StyleSheet: { create: <T,>(value: T) => value },
    Easing: { bezier: () => (value: number) => value },
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => runtime.reduceMotion,
      addEventListener: () => ({ remove: vi.fn() }),
    },
    Animated: {
      Value,
      View: "AnimatedView",
      timing: (value: Value, options: { duration: number; toValue: number }) => ({
        start: (callback: (result: { finished: boolean }) => void) => {
          const complete = (finished: boolean) => {
            if (finished) value.setValue(options.toValue);
            callback({ finished });
          };
          const timer =
            runtime.mode === "missing"
              ? undefined
              : setTimeout(() => complete(runtime.mode === "finished"), options.duration);
          const stop = () => {
            clearTimeout(timer);
            callback({ finished: false });
          };
          value.stop = stop;
          runtime.animations.push({ complete, notify: (finished) => callback({ finished }), stop });
        },
      }),
    },
  };
});
vi.mock("@/components/chat/animated-narra-face", () => ({ AnimatedNarraFace: "Face" }));
vi.mock("@/components/chat/narra-chat-header", () => ({ NARRA_CHAT_EMBEDDED_TOP_INSET: 0 }));
vi.mock("@/components/chats/character-chat-list", () => ({
  CharacterChatAvatar: "Avatar",
  CharacterChatList: "Chats",
}));
vi.mock("@/components/narra/character-portrait-image", () => ({
  CharacterPortraitImage: "Portrait",
}));
vi.mock("@/components/navigation/SystemSheetZoomDestination", () => ({
  SystemSheetZoomDestination: "Sheet",
}));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/components/ui/NativeButton", () => ({ NativeButton: "RetryButton" }));
vi.mock("@/components/ui/initials-avatar", () => ({ InitialsAvatar: "Avatar" }));
vi.mock("@/hooks/use-backend-book", () => ({ useBackendBook: vi.fn() }));
vi.mock("@/lib/analytics/telemetry", () => ({ recordTelemetry: vi.fn() }));
vi.mock("@/lib/narra/backend-book-sync", () => ({
  retryBackendBookAnalysis: runtime.retry,
  retryBackendBookSync: runtime.retry,
  useBackendBookStatus: (select: (state: unknown) => unknown) =>
    select({ books: { book: { error: "HTTP_502" } } }),
}));
vi.mock("@/lib/notifications", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/screens/ChatScreen", () => ({ ChatScreen: "Chat" }));
vi.mock("@/screens/NarraCharacterChatScreen", () => ({
  NarraCharacterChatScreen: "CharacterChat",
}));
vi.mock("@/stores", () => ({
  useLibraryStore: (select: (state: unknown) => unknown) =>
    select({ books: [{ id: "book", format: "epub", progress: 0.5 }] }),
  useNarraStore: (select: (state: unknown) => unknown) => select({ books: { book: {} } }),
}));
vi.mock("@/styles/theme", () => ({
  ElevatedSurfaceTheme: "Theme",
  useTheme: () => ({ colors: {} }),
  fontWeight: {},
  spacing: {},
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

import { NarraCharactersScreen } from "@/screens/NarraCharactersScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
beforeEach(() => {
  vi.useFakeTimers();
  runtime.mode = "finished";
  runtime.dropFrames = false;
  runtime.reduceMotion = false;
  runtime.animations.length = 0;
  runtime.retry.mockClear();
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) =>
    runtime.dropFrames ? 99999 : setTimeout(() => callback(Date.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount(strict = false) {
  const props = {
    route: { params: { bookId: "book" } },
    navigation: { navigate: vi.fn(), goBack: vi.fn() },
  } as unknown as ComponentProps<typeof NarraCharactersScreen>;
  await act(async () => {
    tree = create(
      strict ? (
        <StrictMode>
          <NarraCharactersScreen {...props} />
        </StrictMode>
      ) : (
        <NarraCharactersScreen {...props} />
      ),
    );
  });
}
function listLayer() {
  const layer = tree.root
    .findAllByType("AnimatedView" as never)
    .find((node) => node.props.importantForAccessibility !== undefined);
  if (!layer) throw new Error("Missing characters accessibility layer");
  return layer;
}
function chat() {
  return tree.root.findByType("Chat" as never);
}
function interactionLayer(node: ReactTestInstance) {
  let parent = node.parent;
  while (parent && parent.props.importantForAccessibility === undefined) parent = parent.parent;
  if (!parent) throw new Error("Missing chat accessibility layer");
  return parent;
}
function expectInteractive(node: ReactTestInstance) {
  expect(node.props.pointerEvents).toBe("auto");
  expect(node.props.accessibilityElementsHidden).toBe(false);
  expect(node.props.importantForAccessibility).toBe("auto");
}
async function openChat() {
  await act(async () => {
    tree.root.findByType("Chats" as never).props.items[0].onPress();
  });
}
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

describe("iOS characters sheet production transition lifecycle", () => {
  it("initial list and Retry are interactive without waiting for any animation", async () => {
    runtime.mode = "missing";
    await mount();
    expectInteractive(listLayer());
    expect(runtime.animations).toHaveLength(0);
    await act(async () => {
      await tree.root.findByType("RetryButton" as never).props.onPress();
    });
    expect(runtime.retry).toHaveBeenCalledOnce();
  });
  it("switches to chat and back with normal animation completion", async () => {
    await mount();
    await openChat();
    await settle();
    expectInteractive(interactionLayer(chat()));
    await act(async () => {
      chat().props.onBack();
    });
    await settle();
    expectInteractive(listLayer());
  });
  it.each(["interrupted", "missing"] as const)(
    "settles a %s animation instead of leaving both layers inaccessible",
    async (mode) => {
      runtime.mode = mode;
      await mount();
      await openChat();
      await settle();
      expectInteractive(interactionLayer(chat()));
      expect(listLayer().props.pointerEvents).toBe("none");
    },
  );
  it("settles even when requestAnimationFrame never runs", async () => {
    runtime.dropFrames = true;
    await mount();
    await openChat();
    await settle();
    expectInteractive(interactionLayer(chat()));
  });
  it("restores list accessibility after a missing return-animation callback", async () => {
    await mount();
    await openChat();
    await settle();
    runtime.mode = "missing";
    await act(async () => {
      chat().props.onBack();
    });
    await settle();
    expectInteractive(listLayer());
    expect(tree.root.findAllByType("Chat" as never)).toHaveLength(0);
  });
  it("survives StrictMode setup/cleanup replay before opening a chat", async () => {
    await mount(true);
    await openChat();
    await settle();
    expectInteractive(interactionLayer(chat()));
  });
  it("ignores an old native completion after the watchdog and a later return to the list", async () => {
    runtime.mode = "missing";
    await mount();
    await openChat();
    await settle();
    const old = runtime.animations[0];
    runtime.mode = "finished";
    await act(async () => {
      chat().props.onBack();
    });
    await settle();
    await act(async () => {
      old.notify(true);
    });
    expectInteractive(listLayer());
    expect(tree.root.findAllByType("Chat" as never)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clears its deadline and does not schedule work from a native completion after unmount", async () => {
    runtime.mode = "missing";
    await mount();
    await openChat();
    const old = runtime.animations[0];
    await act(async () => {
      tree.unmount();
    });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      old.notify(true);
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(runtime.animations).toHaveLength(1);
  });
  it("does not leave a visible cover or a watchdog behind when reduce motion is enabled", async () => {
    runtime.reduceMotion = true;
    await mount();
    await openChat();
    expectInteractive(interactionLayer(chat()));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      chat().props.onBack();
    });
    await settle();
    expectInteractive(listLayer());
    expect(listLayer().props.style.at(-1).opacity.current).toBe(1);
    expect(runtime.animations).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("forces the selected layer opaque after the 600 ms transition deadline", async () => {
    runtime.mode = "missing";
    await mount();
    await openChat();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(listLayer().props.pointerEvents).toBe("none");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expectInteractive(interactionLayer(chat()));
    const cover = tree.root
      .findAllByType("AnimatedView" as never)
      .find(
        (node) =>
          node.props.pointerEvents === "none" && node.props.importantForAccessibility === undefined,
      );
    expect(cover?.props.style.at(-1).opacity.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
