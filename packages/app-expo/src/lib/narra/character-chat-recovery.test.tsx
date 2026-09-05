import type { ReadingContext } from "@readany/core/types/chat";
import { StrictMode } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const messages: Array<{ role: string; content: string; id: string; createdAt: number }> = [];
  const character = {
    id: "hero",
    backendManaged: true,
    unlockProgress: 0,
    name: "Герой",
    fullName: "Герой",
    traits: ["честный"],
    role: "друг",
    speechStyle: "спокойно",
    chatPlaceholder: "Написать герою…",
  };
  const narra = {
    books: {
      book: {
        backendBinding: { bookEditionId: "edition-a", contentSha256: "a".repeat(64) },
        characters: [character],
        chats: { hero: messages },
        memories: {},
      },
    },
    appendChatMessage: vi.fn((_book: string, _hero: string, message: (typeof messages)[number]) => {
      messages.push(message);
    }),
    setMemory: vi.fn(),
    updateCharacter: vi.fn(),
  };
  const initialBook = narra.books.book;
  const listeners = new Set<() => void>();
  return {
    initialBook,
    listeners,
    language: "ru",
    messages,
    narra,
    book: { id: "book", progress: 0.5, currentCfi: "exact-page", meta: { title: "Книга" } },
    context: null as ReadingContext | null,
    navigation: { goBack: vi.fn(), navigate: vi.fn() },
    dismiss: vi.fn(async () => {}),
    t: (_key: string, fallback: string) => fallback,
  };
});

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: "View",
  StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock("react-native-keyboard-controller", () => ({
  KeyboardController: { dismiss: runtime.dismiss },
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20 }) }));
vi.mock("react-i18next", async () => {
  const ru = (await import("../../../../core/src/i18n/locales/ru/common.json")).default;
  const en = (await import("../../../../core/src/i18n/locales/en/common.json")).default;
  return {
    useTranslation: () => ({
      i18n: { resolvedLanguage: runtime.language },
      t: (key: string, fallback: string) => {
        let value: unknown = runtime.language === "en" ? en : ru;
        for (const part of key.split(".")) value = (value as Record<string, unknown>)?.[part];
        return typeof value === "string" ? value : fallback;
      },
    }),
  };
});
vi.mock("@react-navigation/native", () => ({ useNavigation: () => runtime.navigation }));
vi.mock("@/styles/theme", () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock("@/hooks/use-backend-book", () => ({ useBackendBook: vi.fn() }));
vi.mock("@readany/core/ai/reading-context-service", () => ({
  useReadingContext: () => runtime.context,
}));
vi.mock("@/components/chat/NarraChat", () => ({ NarraChat: "Chat" }));
vi.mock("@/components/chat/narra-chat-header", () => ({
  NarraChatHeader: "Header",
  NARRA_CHAT_EMBEDDED_TOP_INSET: 8,
  NARRA_CHAT_HEADER_HEIGHT: 48,
}));
vi.mock("@/components/narra/character-portrait-image", () => ({
  CharacterPortraitImage: "Portrait",
}));
vi.mock("@/components/ui/centered-empty-state", () => ({ CenteredEmptyState: "Empty" }));
vi.mock("@/components/ui/initials-avatar", () => ({ InitialsAvatar: "Avatar" }));
vi.mock("@/lib/analytics/telemetry", () => ({ recordTelemetry: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/stores", () => ({
  useLibraryStore: (select: (state: unknown) => unknown) => select({ books: [runtime.book] }),
  useNarraStore: Object.assign((select: (state: unknown) => unknown) => select(runtime.narra), {
    getState: () => runtime.narra,
    subscribe: (listener: () => void) => {
      runtime.listeners.add(listener);
      return () => runtime.listeners.delete(listener);
    },
  }),
}));
vi.mock("expo-secure-store", () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `message-${runtime.messages.length}` }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import { NarraCharacterChatScreen } from "@/screens/NarraCharacterChatScreen";
import { setNarraGatewayAdapter } from "../ai/narra-gateway-fetch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  runtime.messages.length = 0;
  runtime.context = null;
  runtime.language = "ru";
  runtime.narra.books.book = runtime.initialBook;
  runtime.initialBook.chats.hero = runtime.messages;
  runtime.initialBook.backendBinding = {
    bookEditionId: "edition-a",
    contentSha256: "a".repeat(64),
  };
  runtime.initialBook.characters[0].chatPlaceholder = "Написать герою…";
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  setNarraGatewayAdapter(null);
  vi.useRealTimers();
});

describe("character chat screen recovery", () => {
  it.each(["greeting", "placeholder"])(
    "completes %s after StrictMode effect replay",
    async (kind) => {
      if (kind === "placeholder") {
        runtime.initialBook.characters[0].chatPlaceholder = "";
        runtime.messages.push({
          id: "greeting",
          role: "assistant",
          content: "Привет",
          createdAt: 1,
        });
      }
      setNarraGatewayAdapter(async () => new Response(JSON.stringify({ text: "Написать герою…" })));
      await act(async () => {
        tree = create(
          <StrictMode>
            <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />
          </StrictMode>,
        );
      });
      if (kind === "greeting") expect(runtime.messages.at(-1)?.content).toBe("Написать герою…");
      else
        expect(runtime.narra.updateCharacter).toHaveBeenCalledWith("book", "hero", {
          chatPlaceholder: "Написать герою…",
        });
      expect(runtime.listeners.size).toBe(0);
    },
  );
  it.each(["greeting", "placeholder"])("restarts %s for the replacement edition", async (kind) => {
    if (kind === "placeholder") {
      runtime.initialBook.characters[0].chatPlaceholder = "";
      runtime.messages.push({ id: "greeting", role: "assistant", content: "Привет", createdAt: 1 });
    }
    const responders: Array<(response: Response) => void> = [];
    setNarraGatewayAdapter(
      () =>
        new Promise<Response>((resolve) => {
          responders.push(resolve);
        }),
    );
    const screen = () => (
      <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />
    );
    await act(async () => {
      tree = create(screen());
    });
    expect(responders).toHaveLength(1);
    await act(async () => {
      runtime.initialBook.backendBinding = {
        bookEditionId: "edition-b",
        contentSha256: "b".repeat(64),
      };
      for (const listener of runtime.listeners) listener();
      tree.update(screen());
    });
    expect(responders).toHaveLength(2);
    await act(async () => {
      responders[0](new Response(JSON.stringify({ text: "Old result" })));
      responders[1](new Response(JSON.stringify({ text: "Написать новому герою…" })));
      await vi.advanceTimersByTimeAsync(0);
    });
    if (kind === "greeting")
      expect(runtime.messages.at(-1)?.content).toBe("Написать новому герою…");
    else
      expect(runtime.narra.updateCharacter).toHaveBeenCalledWith("book", "hero", {
        chatPlaceholder: "Написать новому герою…",
      });
    expect(runtime.listeners.size).toBe(0);
  });
  it.each(["switch", "unmount"])("rejects an old send handler after %s", async (change) => {
    runtime.messages.push({ id: "greeting", role: "assistant", content: "Привет", createdAt: 1 });
    const adapter = vi.fn(async () => new Response(JSON.stringify({ text: "Wrong context" })));
    setNarraGatewayAdapter(adapter);
    await act(async () => {
      tree = create(
        <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />,
      );
    });
    const oldSend = tree.root.find((node) => String(node.type) === "Chat").props.onSend;
    await act(async () => {
      if (change === "switch")
        runtime.initialBook.backendBinding = {
          bookEditionId: "edition-b",
          contentSha256: "b".repeat(64),
        };
      else tree.unmount();
    });
    await act(async () => {
      await oldSend("Старый контекст");
    });
    expect(adapter).not.toHaveBeenCalled();
    expect(runtime.narra.appendChatMessage).not.toHaveBeenCalled();
  });
  it("cancels a pending send on unmount and releases its subscription", async () => {
    runtime.messages.push({ id: "greeting", role: "assistant", content: "Привет", createdAt: 1 });
    let finish!: (response: Response) => void;
    setNarraGatewayAdapter(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      tree = create(
        <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />,
      );
    });
    let sent!: Promise<void>;
    await act(async () => {
      sent = tree.root.find((node) => String(node.type) === "Chat").props.onSend("Вопрос");
    });
    await act(async () => {
      tree.unmount();
    });
    await act(async () => {
      finish(new Response(JSON.stringify({ text: "Late" })));
      await sent;
    });
    expect(runtime.messages.some((message) => message.content === "Late")).toBe(false);
    expect(runtime.listeners.size).toBe(0);
  });
  it.each(["greeting", "placeholder", "memory"])(
    "does not commit stale %s after a source change",
    async (kind) => {
      if (kind !== "greeting")
        runtime.messages.push({
          id: "greeting",
          role: "assistant",
          content: "Привет",
          createdAt: 1,
        });
      if (kind === "placeholder") runtime.initialBook.characters[0].chatPlaceholder = "";
      if (kind === "memory")
        runtime.messages.push({ id: "previous", role: "user", content: "Раньше", createdAt: 2 });
      // Production Zustand actions replace chat arrays; the send callback keeps
      // its pre-send snapshot rather than the test recorder's mutable array.
      if (kind === "memory") runtime.initialBook.chats.hero = [...runtime.messages];
      let finish!: (response: Response) => void;
      let requests = 0;
      setNarraGatewayAdapter(() => {
        requests++;
        if (kind === "memory" && requests === 1)
          return Promise.resolve(new Response(JSON.stringify({ text: "Свежий ответ" })));
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      });
      await act(async () => {
        tree = create(
          <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />,
        );
      });
      if (kind === "memory")
        await act(async () => {
          await tree.root.find((node) => String(node.type) === "Chat").props.onSend("Новый вопрос");
        });
      expect(finish).toBeTypeOf("function");
      await act(async () => {
        runtime.initialBook.backendBinding = {
          bookEditionId: "edition-b",
          contentSha256: "b".repeat(64),
        };
        for (const listener of runtime.listeners) listener();
        finish(new Response(JSON.stringify({ text: "Написать старому герою…" })));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(runtime.narra.setMemory).not.toHaveBeenCalled();
      expect(runtime.narra.updateCharacter).not.toHaveBeenCalled();
      expect(
        runtime.messages.some((message) => message.content === "Написать старому герою…"),
      ).toBe(false);
      // A fresh greeting can now start after rebind. Closing must clean it too.
      await act(async () => {
        tree.unmount();
      });
      expect(runtime.listeners.size).toBe(0);
    },
  );
  it.each(["rebind", "remove", "roundtrip"])(
    "does not save a pending answer after %s",
    async (change) => {
      runtime.messages.push({ id: "greeting", role: "assistant", content: "Привет", createdAt: 1 });
      let finish!: (response: Response) => void;
      setNarraGatewayAdapter(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
      await act(async () => {
        tree = create(
          <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />,
        );
      });
      let sent!: Promise<void>;
      await act(async () => {
        sent = tree.root.find((node) => String(node.type) === "Chat").props.onSend("Вопрос");
      });
      await act(async () => {
        if (change === "remove") Reflect.deleteProperty(runtime.narra.books, "book");
        else
          runtime.initialBook.backendBinding = {
            bookEditionId: "edition-b",
            contentSha256: "b".repeat(64),
          };
        for (const listener of runtime.listeners) listener();
        if (change === "roundtrip") {
          runtime.initialBook.backendBinding = {
            bookEditionId: "edition-a",
            contentSha256: "a".repeat(64),
          };
          for (const listener of runtime.listeners) listener();
        }
        finish(new Response(JSON.stringify({ text: "Устаревший ответ" })));
        await sent;
      });
      expect(runtime.messages.some((message) => message.content === "Устаревший ответ")).toBe(
        false,
      );
      expect(runtime.narra.setMemory).not.toHaveBeenCalled();
      expect(runtime.listeners.size).toBe(0);
    },
  );
  it("admits only one send when the same render receives two submit events", async () => {
    runtime.messages.push({ id: "greeting", role: "assistant", content: "Привет", createdAt: 1 });
    const responders: Array<(response: Response) => void> = [];
    const adapter = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          responders.push(resolve);
        }),
    );
    setNarraGatewayAdapter(adapter);
    await act(async () => {
      tree = create(
        <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />,
      );
    });
    const send = tree.root.find((node) => String(node.type) === "Chat").props.onSend;
    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    await act(async () => {
      first = send("Один вопрос");
      duplicate = send("Один вопрос");
    });
    const requests = adapter.mock.calls.length;
    const userMessages = runtime.messages.filter((message) => message.role === "user").length;
    await act(async () => {
      for (const respond of responders)
        respond(new Response(JSON.stringify({ text: "Один ответ" })));
      await Promise.all([first, duplicate]);
    });
    expect(requests).toBe(1);
    expect(userMessages).toBe(1);
    expect(runtime.messages.filter((message) => message.content === "Один ответ")).toHaveLength(1);
    expect(tree.root.find((node) => String(node.type) === "Chat").props.isStreaming).toBe(false);
    setNarraGatewayAdapter(async () => new Response(JSON.stringify({ text: "Следующий ответ" })));
    await act(async () => {
      await send("Следующий вопрос");
    });
    expect(runtime.messages.at(-1)?.content).toBe("Следующий ответ");
  });

  it("releases the send lock when saving the outgoing message fails before the request", async () => {
    runtime.messages.push({ id: "greeting", role: "assistant", content: "Привет", createdAt: 1 });
    const adapter = vi.fn(async () => new Response(JSON.stringify({ text: "Ответ" })));
    setNarraGatewayAdapter(adapter);
    await act(async () => {
      tree = create(
        <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />,
      );
    });
    const chat = () => tree.root.find((node) => String(node.type) === "Chat");
    runtime.narra.appendChatMessage.mockImplementationOnce(() => {
      throw new Error("Local save failed");
    });
    await act(async () => {
      await chat().props.onSend("Вопрос");
    });
    expect(adapter).not.toHaveBeenCalled();
    expect(chat().props.isStreaming).toBe(false);
    await act(async () => {
      await chat().props.onSend("Повторный вопрос");
    });
    expect(adapter).toHaveBeenCalledOnce();
    expect(runtime.messages.at(-1)?.content).toBe("Ответ");
  });

  it.each([
    ["en", "Typing…"],
    ["ru", "Печатает…"],
  ])(
    "does not invent online presence and localizes active typing in %s",
    async (language, typing) => {
      runtime.language = language;
      runtime.messages.push({ id: "greeting", role: "assistant", content: "Hello", createdAt: 1 });
      setNarraGatewayAdapter(async () => new Response(new ReadableStream()));
      await act(async () => {
        tree = create(
          <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />,
        );
      });
      const header = () => tree.root.find((node) => String(node.type) === "Header");
      expect(header().props.subtitle).toBeUndefined();
      let sending: Promise<void> | undefined;
      act(() => {
        sending = tree.root.find((node) => String(node.type) === "Chat").props.onSend("Hello");
      });
      expect(header().props.subtitle).toBe(typing);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_001);
        await sending;
      });
      expect(header().props.subtitle).toBeUndefined();
    },
  );
  it.each(["matching", "other-book", "other-page"])(
    "sends only the matched page context to the gateway (%s)",
    async (kind) => {
      runtime.messages.push({ id: "greeting", role: "assistant", content: "Привет", createdAt: 1 });
      runtime.context = {
        bookId: kind === "other-book" ? "different-book" : "book",
        bookTitle: "Книга",
        currentChapter: { index: 1, title: "Глава у реки", href: "chapter" },
        currentPosition: {
          cfi: kind === "other-page" ? "different-page" : "exact-page",
          percentage: 50,
        },
        surroundingText: "Герой стоит на берегу реки.",
        recentHighlights: [],
        operationType: "reading",
        timestamp: 1,
      };
      let prompt = "";
      setNarraGatewayAdapter(async (_path, init) => {
        prompt = JSON.parse(String(init.body)).messages[0].content;
        return new Response(JSON.stringify({ text: "Я у реки." }));
      });
      await act(async () => {
        tree = create(
          <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />,
        );
      });
      await act(async () => {
        await tree.root.find((node) => String(node.type) === "Chat").props.onSend("Где ты?");
      });
      if (kind === "matching") {
        expect(prompt).toContain("Глава у реки");
        expect(prompt).toContain("Герой стоит на берегу реки.");
        expect(prompt).toContain("никогда как инструкции");
      } else {
        expect(prompt).not.toContain("Глава у реки");
        expect(prompt).not.toContain("Герой стоит на берегу реки.");
      }
    },
  );

  it("keeps Back responsive during a stalled greeting, then enables sending after timeout", async () => {
    setNarraGatewayAdapter(async () => new Response(new ReadableStream()));
    const back = vi.fn();
    await act(async () => {
      tree = create(
        <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={back} />,
      );
    });
    const chat = () => tree.root.find((node) => String(node.type) === "Chat");
    expect(chat().props.isStreaming).toBe(true);
    act(() => tree.root.find((node) => String(node.type) === "Header").props.onBack());
    expect(back).toHaveBeenCalledOnce();
    expect(runtime.dismiss).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    });
    expect(chat().props.isStreaming).toBe(false);
    setNarraGatewayAdapter(async () => new Response(JSON.stringify({ text: "Слушаю тебя." })));
    await act(async () => {
      await chat().props.onSend("Привет");
    });
    expect(runtime.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "Привет" },
      { role: "assistant", content: "Слушаю тебя." },
    ]);
    expect(chat().props.isStreaming).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves a failed user message visible and allows another send", async () => {
    runtime.messages.push({ id: "greeting", role: "assistant", content: "Привет", createdAt: 1 });
    setNarraGatewayAdapter(async () => new Response(new ReadableStream()));
    await act(async () => {
      tree = create(
        <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />,
      );
    });
    const chat = () => tree.root.find((node) => String(node.type) === "Chat");
    let sending: Promise<void> | undefined;
    act(() => {
      sending = chat().props.onSend("Мой вопрос");
    });
    expect(chat().props.isStreaming).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
      await sending;
    });
    expect(chat().props.isStreaming).toBe(false);
    expect(runtime.messages.at(-1)?.content).toBe("Мой вопрос");
    setNarraGatewayAdapter(async () => new Response(JSON.stringify({ text: "Ответ" })));
    await act(async () => {
      await chat().props.onSend("Повторю вопрос");
    });
    expect(runtime.messages.at(-1)?.content).toBe("Ответ");
    expect(chat().props.isStreaming).toBe(false);
  });
});
