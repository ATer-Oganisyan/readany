import type { ReadingContext } from "@readany/core/types/chat";
import { createHash } from "node:crypto";
import { StrictMode } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recordedLive from "../../../../../docs/reviews/evidence/character-chat-live-2026-09-05.json";

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
import { toast } from "@/lib/notifications";
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
  it.each(["matching", "other-book", "recorded-live"])(
    "serializes the real Anna chat prompt and commits its parsed reply (%s context)",
    async (contextKind) => {
      // Own short fixture. Existing history/placeholder prevent auxiliary AI calls.
      const excerpt = "Анна заметила течь в лодке и спокойно позвала Льва. Лев принёс доску.";
      const futureText = "В финале Анна переехала на СЕВЕРНЫЙ_ОСТРОВ.";
      const foreignExcerpt = `В чужой книге капитан нашёл ЗОЛОТОЙ_МАЯК. ${futureText}`;
      const memory = "Читателя зовут Ира; она боится глубокой воды.";
      const history = {
        id: "anna-greeting",
        role: "assistant",
        content: "Я рядом, Ира.",
        createdAt: 1,
      };
      const question = "Почему ты позвала Льва?";
      const matchingBook = contextKind !== "other-book";
      // Offline replay of the actual HTTP completion, not another model call.
      const reply = contextKind === "recorded-live"
        ? recordedLive.completion.text
        : "Я заметила течь и позвала Льва: он принёс доску, чтобы помочь.";
      const originalBook = runtime.book;
      runtime.book = { ...originalBook, meta: { title: "Наша лодка" }, progress: 0.25 };
      runtime.messages.push(history);
      runtime.narra.books.book = {
        ...runtime.initialBook,
        characters: [
          {
            ...runtime.initialBook.characters[0],
            name: "Анна",
            fullName: "Анна",
            traits: ["спокойная", "внимательная"],
            role: "лодочница",
            speechStyle: "коротко и тепло",
          },
        ],
        memories: { hero: memory },
        // Immutable snapshot, like production Zustand; no accidental memory refresh.
        chats: { hero: [history] },
      };
      runtime.context = {
        bookId: matchingBook ? "book" : "other-book",
        bookTitle: matchingBook ? "Наша лодка" : "Чужой роман",
        currentChapter: { index: 0, title: "У берега", href: "chapter-one" },
        currentPosition: { cfi: "exact-page", percentage: 25 },
        surroundingText: matchingBook ? excerpt : foreignExcerpt,
        recentHighlights: [],
        operationType: "reading",
        timestamp: 1,
      };
      const adapter = vi.fn(
        async (_path: string, _init: RequestInit) =>
          new Response(JSON.stringify(contextKind === "recorded-live"
            ? recordedLive.completion : { text: `  ${reply}  ` })),
      );
      setNarraGatewayAdapter(adapter);
      try {
        await act(async () => {
          tree = create(
            <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />,
          );
        });
        expect(adapter).not.toHaveBeenCalled();
        await act(async () => {
          await tree.root.find((node) => String(node.type) === "Chat").props.onSend(question);
        });
        expect(adapter).toHaveBeenCalledOnce();
        const [path, init] = adapter.mock.calls[0];
        expect(path).toBe("/v2/ai/chat/complete");
        expect(init.method).toBe("POST");
        const body = JSON.parse(String(init.body));
        if (contextKind === "recorded-live") {
          const { request_id: _requestId, ...request } = body;
          expect(createHash("sha256").update(JSON.stringify(request)).digest("hex"))
            .toBe(recordedLive.mobileRequestSha256);
        }
        const prompt = body.messages[0].content;
        expect(body).toEqual({
          messages: [
            { role: "system", content: expect.any(String) },
            { role: "assistant", content: history.content },
            { role: "user", content: question },
          ],
          temperature: 0.85,
          purpose: "character_chat",
          origin: "user",
          analytics_tier: "essential",
          request_id: expect.any(String),
        });
        for (const fragment of [
          "Ты — Анна",
          "Наша лодка",
          "спокойная, внимательная",
          "лодочница",
          "коротко и тепло",
          "25%",
          memory,
        ])
          expect(prompt).toContain(fragment);
        expect(prompt).not.toContain(foreignExcerpt);
        expect(prompt).not.toContain(futureText);
        if (matchingBook) expect(prompt).toContain(excerpt);
        else expect(prompt).not.toContain(excerpt);
        expect(runtime.narra.appendChatMessage).toHaveBeenCalledTimes(2);
        expect(runtime.narra.appendChatMessage).toHaveBeenNthCalledWith(
          1,
          "book",
          "hero",
          expect.objectContaining({ role: "user", content: question }),
        );
        expect(runtime.narra.appendChatMessage).toHaveBeenNthCalledWith(
          2,
          "book",
          "hero",
          expect.objectContaining({ role: "assistant", content: reply }),
        );
        expect(runtime.messages.at(-1)?.content).toBe(reply);
        expect(runtime.narra.setMemory).not.toHaveBeenCalled();
        if (contextKind === "matching" && process.env.NARRA_CHARACTER_CANARY_CAPTURE === "1") {
          const { request_id: _requestId, ...request } = body;
          console.log(
            `NARRA_CHARACTER_CANARY_ARTIFACT:${JSON.stringify({
              fixtureId: "anna-boat-character-chat-v1",
              path,
              method: init.method,
              request,
              parsedReply: runtime.messages.at(-1)?.content,
              live: false,
            })}`,
          );
        }
      } finally {
        runtime.book = originalBook;
      }
    },
  );

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

  it("does not save a rejected truncated completion or retry it automatically", async () => {
    runtime.messages.push({ id: "greeting", role: "assistant", content: "Привет", createdAt: 1 });
    const adapter = vi.fn(async () => new Response(JSON.stringify({
      code: "PARSE",
      error: "LLM completion was truncated by its output limit",
      // Even a malformed server error containing text must not become a chat reply.
      text: "Я хотел сказать, что",
    }), { status: 502 }));
    setNarraGatewayAdapter(adapter);
    await act(async () => {
      tree = create(
        <NarraCharacterChatScreen embedded bookId="book" characterId="hero" onBack={vi.fn()} />,
      );
    });
    const chat = () => tree.root.find((node) => String(node.type) === "Chat");
    await act(async () => { await chat().props.onSend("Мой вопрос"); });
    expect(adapter).toHaveBeenCalledOnce();
    expect(runtime.messages.map(({ content }) => content)).toEqual(["Привет", "Мой вопрос"]);
    expect(runtime.narra.appendChatMessage).toHaveBeenCalledOnce();
    expect(runtime.narra.setMemory).not.toHaveBeenCalled();
    expect(chat().props.isStreaming).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Не удалось получить ответ", {
      description: "Ответ оборвался и не был сохранён. Попробуйте ещё раз.",
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
    expect(adapter).toHaveBeenCalledOnce();
    adapter.mockImplementation(async () => new Response(JSON.stringify({ text: "Полный ответ." })));
    await act(async () => { await chat().props.onSend("Повторю вопрос"); });
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(runtime.messages.at(-1)?.content).toBe("Полный ответ.");
    expect(chat().props.isStreaming).toBe(false);
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
