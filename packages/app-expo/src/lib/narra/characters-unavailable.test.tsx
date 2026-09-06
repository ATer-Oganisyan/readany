import type { ComponentProps } from "react";
import { StrictMode } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  language: "ru",
  error: "BOOK_FORMAT_UNSUPPORTED",
  manifest: undefined as
    | undefined
    | {
        availability: string;
        analysis?: {
          runId: string;
          status: string;
          stage: string;
          completedScanChunks?: number;
          updatedAt?: string;
        };
      },
  binding: undefined as undefined | { resolution: string },
  retrySync: vi.fn(async () => {}),
  retryAnalysis: vi.fn(async () => {}),
  refreshStatus: vi.fn(async () => {}),
  toastError: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  View: "View",
  ScrollView: "ScrollView",
  StyleSheet: { create: <T,>(value: T) => value },
  Easing: { bezier: () => () => 0 },
  Animated: {},
  AccessibilityInfo: {},
}));
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
  retryBackendBookAnalysis: runtime.retryAnalysis,
  retryBackendBookSync: runtime.retrySync,
  refreshBackendBookStatus: runtime.refreshStatus,
  useBackendBookStatus: (select: (state: unknown) => unknown) =>
    select({ books: { book: { error: runtime.error, manifest: runtime.manifest } } }),
}));
vi.mock("@/lib/notifications", () => ({ toast: { error: runtime.toastError } }));
vi.mock("@/screens/ChatScreen", () => ({ ChatScreen: "Chat" }));
vi.mock("@/screens/NarraCharacterChatScreen", () => ({
  NarraCharacterChatScreen: "CharacterChat",
}));
vi.mock("@/stores", () => ({
  useLibraryStore: (select: (state: unknown) => unknown) =>
    select({ books: [{ id: "book", format: "mobi", progress: 0.5 }] }),
  useNarraStore: (select: (state: unknown) => unknown) =>
    select({ books: { book: { backendBinding: runtime.binding } } }),
}));
vi.mock("@/styles/theme", () => ({
  ElevatedSurfaceTheme: "Theme",
  useTheme: () => ({ colors: {} }),
  fontWeight: {},
  spacing: {},
}));
vi.mock("react-i18next", async () => {
  const ru = (await import("../../../../core/src/i18n/locales/ru/common.json")).default;
  const en = (await import("../../../../core/src/i18n/locales/en/common.json")).default;
  return {
    useTranslation: () => ({
      t: (key: string, fallback: string) => {
        let value: unknown = runtime.language === "ru" ? ru : en;
        for (const part of key.split(".")) value = (value as Record<string, unknown>)?.[part];
        return typeof value === "string" ? value : fallback;
      },
    }),
  };
});

import { NarraCharactersScreen } from "@/screens/NarraCharactersScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
beforeEach(() => {
  runtime.error = "BOOK_FORMAT_UNSUPPORTED";
  runtime.language = "ru";
  runtime.binding = undefined;
  runtime.manifest = undefined;
  runtime.retrySync.mockReset().mockResolvedValue(undefined);
  runtime.retryAnalysis.mockReset().mockResolvedValue(undefined);
  runtime.refreshStatus.mockReset().mockResolvedValue(undefined);
  runtime.toastError.mockReset();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  vi.useRealTimers();
});

async function mountScreen(strict = false) {
  const navigation = { navigate: vi.fn(), goBack: vi.fn() };
  const props = { route: { params: { bookId: "book" } }, navigation } as unknown as ComponentProps<
    typeof NarraCharactersScreen
  >;
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
  return navigation;
}

function renderedText() {
  return tree.root
    .findAllByType("Text" as never)
    .flatMap((node) => node.children)
    .join(" ");
}

describe("characters unavailable message", () => {
  it("keeps running work active and clears its waiting timer on StrictMode unmount", async () => {
    vi.useFakeTimers();
    runtime.error = "";
    runtime.manifest = {
      availability: "processing",
      analysis: { runId: "run", status: "running", stage: "scan", completedScanChunks: 1 },
    };
    await mountScreen(true);
    expect(tree.root.findByType("Chats" as never).props.items[0].subtitle).toBe("Ищу персонажей…");
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(tree.root.findByType("RetryButton" as never).props.label).toBe("Обновить статус");
    expect(runtime.toastError).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("resets waiting on actual scan progress but not a polling timestamp", async () => {
    vi.useFakeTimers();
    runtime.error = "";
    runtime.manifest = {
      availability: "processing",
      analysis: { runId: "run", status: "running", stage: "scan", completedScanChunks: 1 },
    };
    const navigation = await mountScreen();
    const rerender = async () => {
      await act(async () => {
        tree.update(
          <NarraCharactersScreen
            {...({ route: { params: { bookId: "book" } }, navigation } as unknown as ComponentProps<
              typeof NarraCharactersScreen
            >)}
          />,
        );
      });
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    runtime.manifest.analysis!.updatedAt = "new-poll-time";
    await rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(tree.root.findAllByType("RetryButton" as never)).toHaveLength(1);
    runtime.manifest.analysis!.completedScanChunks = 2;
    await rerender();
    expect(tree.root.findAllByType("RetryButton" as never)).toHaveLength(0);
    await act(async () => {
      tree.unmount();
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    ["ru", "Анализ в очереди. Можно продолжить читать", "Обновить статус"],
    ["en", "Analysis is queued. You can keep reading", "Refresh status"],
  ])(
    "honestly shows queued analysis and refreshes without restarting in %s",
    async (language, subtitle, label) => {
      vi.useFakeTimers();
      runtime.language = language;
      runtime.error = "";
      runtime.manifest = {
        availability: "processing",
        analysis: { runId: "run", status: "queued", stage: "prepare", completedScanChunks: 0 },
      };
      await mountScreen();
      expect(tree.root.findByType("Chats" as never).props.items[0].subtitle).toBe(subtitle);
      expect(tree.root.findAllByType("RetryButton" as never)).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      const button = tree.root.findByType("RetryButton" as never);
      expect(button.props.label).toBe(label);
      await act(async () => {
        await button.props.onPress();
      });
      expect(runtime.refreshStatus).toHaveBeenCalledExactlyOnceWith("book");
      expect(runtime.retrySync).not.toHaveBeenCalled();
      expect(runtime.retryAnalysis).not.toHaveBeenCalled();
      expect(runtime.toastError).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["ru", "Персонажи недоступны для этого формата", "Книгу можно читать."],
    ["en", "Characters are unavailable for this format", "You can keep reading."],
  ])("explains unsupported format and continued reading in %s", async (language, title, hint) => {
    runtime.language = language;
    const props = {
      route: { params: { bookId: "book" } },
      navigation: { navigate: vi.fn() },
    } as unknown as ComponentProps<typeof NarraCharactersScreen>;
    await act(async () => {
      tree = create(<NarraCharactersScreen {...props} />);
    });
    const rendered = tree.root
      .findAllByType("Text" as never)
      .flatMap((node) => node.children)
      .join(" ");
    expect(rendered).toContain(title);
    expect(rendered).toContain(hint);
    expect(rendered).toContain("EPUB, FB2, TXT");
    expect(rendered).not.toContain("Импортируйте тот же файл снова");
    expect(tree.root.findAllByType("RetryButton" as never)).toHaveLength(0);
  });

  it.each([
    ["en", "Couldn't load characters", "You can keep reading.", "Retry"],
    ["ru", "Не удалось загрузить персонажей", "Можно продолжать читать.", "Повторить"],
  ])(
    "offers a localized sync retry for a transient failure in %s without leaving the reader",
    async (language, title, hint, label) => {
      runtime.language = language;
      runtime.error = "HTTP_502";
      const navigation = await mountScreen();
      expect(renderedText()).toContain(title);
      expect(renderedText()).toContain(hint);
      const button = tree.root.findByType("RetryButton" as never);
      expect(button.props.label).toBe(label);
      await act(async () => {
        await button.props.onPress();
      });
      expect(runtime.retrySync).toHaveBeenCalledExactlyOnceWith("book");
      expect(runtime.retryAnalysis).not.toHaveBeenCalled();
      expect(navigation.navigate).not.toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["en", "The original book file is needed", "Add the same original file again"],
    ["ru", "Нужен исходный файл книги", "Добавьте тот же исходный файл снова"],
  ])(
    "explains missing source recovery without a pointless network retry in %s",
    async (language, title, hint) => {
      runtime.language = language;
      runtime.error = "SOURCE_UNAVAILABLE";
      await mountScreen();
      expect(renderedText()).toContain(title);
      expect(renderedText()).toContain(hint);
      expect(tree.root.findAllByType("RetryButton" as never)).toHaveLength(0);
    },
  );

  it.each(["private", "catalog", undefined])(
    "retries analysis only for a terminal private binding: %s",
    async (resolution) => {
      runtime.error = "ANALYSIS_FAILED";
      runtime.manifest = { availability: "failed" };
      runtime.binding = resolution ? { resolution } : undefined;
      await mountScreen();
      await act(async () => {
        await tree.root.findByType("RetryButton" as never).props.onPress();
      });
      expect(runtime.retryAnalysis).toHaveBeenCalledTimes(resolution === "private" ? 1 : 0);
      expect(runtime.retrySync).toHaveBeenCalledTimes(resolution === "private" ? 0 : 1);
    },
  );

  it.each([
    ["en", "failed", "private", "Couldn't load characters", "Retry"],
    ["ru", "cancelled", "private", "Не удалось загрузить персонажей", "Повторить"],
    ["en", "failed", "catalog", "Couldn't load characters", "Retry"],
    ["ru", "failed", undefined, "Не удалось загрузить персонажей", "Повторить"],
  ] as const)(
    "executes the localized terminal toast retry for %s %s with binding %s",
    async (language, availability, resolution, title, label) => {
      runtime.language = language;
      runtime.error = "ANALYSIS_FAILED";
      runtime.manifest = { availability };
      runtime.binding = resolution ? { resolution } : undefined;
      const navigation = await mountScreen();
      expect(runtime.toastError).toHaveBeenCalledTimes(1);
      const call = runtime.toastError.mock.calls[0];
      if (!call) throw new Error("Terminal failure toast was not shown");
      const [message, options] = call;
      expect(message).toBe(title);
      expect(options.action.label).toBe(label);
      await act(async () => {
        await options.action.onClick();
      });
      const expectedRetry = resolution === "private" ? runtime.retryAnalysis : runtime.retrySync;
      const otherRetry = resolution === "private" ? runtime.retrySync : runtime.retryAnalysis;
      expect(expectedRetry).toHaveBeenCalledExactlyOnceWith("book");
      expect(otherRetry).not.toHaveBeenCalled();
      expect(runtime.toastError).toHaveBeenCalledTimes(1);
      expect(navigation.navigate).not.toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
    },
  );

  it.each(["SOURCE_UNAVAILABLE", "BOOK_FORMAT_UNSUPPORTED"])(
    "does not offer an ineffective terminal toast retry for %s",
    async (error) => {
      runtime.error = error;
      runtime.manifest = { availability: "failed" };
      runtime.binding = { resolution: "private" };
      await mountScreen();
      expect(runtime.toastError).toHaveBeenCalledTimes(1);
      expect(runtime.toastError.mock.calls[0]?.[1].action).toBeUndefined();
      expect(runtime.retryAnalysis).not.toHaveBeenCalled();
      expect(runtime.retrySync).not.toHaveBeenCalled();
    },
  );

  it("keeps a single visible retry pending until sync finishes, then permits another attempt", async () => {
    runtime.error = "CONNECTION";
    let finish!: () => void;
    runtime.retrySync.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    await mountScreen();
    await act(async () => {
      void tree.root.findByType("RetryButton" as never).props.onPress();
      void tree.root.findByType("RetryButton" as never).props.onPress();
    });
    expect(runtime.retrySync).toHaveBeenCalledTimes(1);
    expect(tree.root.findByType("RetryButton" as never).props.loading).toBe(true);
    await act(async () => {
      finish();
    });
    expect(tree.root.findByType("RetryButton" as never).props.loading).toBe(false);
  });

  it("reports a failed retry in the interface language without navigating away", async () => {
    runtime.language = "en";
    runtime.error = "CONNECTION";
    runtime.retrySync.mockRejectedValueOnce(new Error("Network error"));
    const navigation = await mountScreen();
    await act(async () => {
      await tree.root.findByType("RetryButton" as never).props.onPress();
    });
    expect(runtime.toastError).toHaveBeenCalledWith("Couldn't load characters");
    expect(tree.root.findByType("RetryButton" as never).props.loading).toBe(false);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("does not surface a late retry failure after the reader closes the characters panel", async () => {
    runtime.error = "CONNECTION";
    let fail!: (error: Error) => void;
    runtime.retrySync.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
    );
    await mountScreen();
    await act(async () => {
      void tree.root.findByType("RetryButton" as never).props.onPress();
    });
    await act(async () => {
      tree.unmount();
    });
    await act(async () => {
      fail(new Error("Network error"));
    });
    expect(runtime.toastError).not.toHaveBeenCalled();
  });
});
