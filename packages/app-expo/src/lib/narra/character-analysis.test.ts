import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { getChunks } from "@readany/core/db/database";
import type { Book } from "@readany/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeBookCharacters } from "./character-analysis";

const store = vi.hoisted(() => ({
  setAnalyzing: vi.fn(),
  setAnalysisError: vi.fn(),
  setCharacters: vi.fn(),
  getBookState: vi.fn(),
  appendChatMessage: vi.fn(),
  setMemory: vi.fn(),
}));

vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ narraGatewayRequest: vi.fn() }));
vi.mock("@/lib/analytics/telemetry", () => ({ recordTelemetry: vi.fn() }));
vi.mock("@/stores/narra-store", () => ({
  useNarraStore: { getState: () => store },
}));
vi.mock("@readany/core/db/database", () => ({ getChunks: vi.fn() }));

const book = {
  id: "book-1",
  meta: { title: "Тестовая книга", author: "Автор" },
} as Book;

function successfulCharacterResponse() {
  return new Response(
    JSON.stringify({
      text: JSON.stringify({
        characters: [{ name: "Анна", fullName: "Анна", unlockProgress: 0.1 }],
      }),
    }),
    { status: 200 },
  );
}

describe("Narra character analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("__DEV__", false);
    vi.mocked(narraGatewayRequest).mockResolvedValue(successfulCharacterResponse());
  });

  it("uses existing chunks before asking for a text fallback", async () => {
    vi.mocked(getChunks).mockResolvedValueOnce([
      { chapterTitle: "Глава из базы", content: "Анна вошла в комнату." },
    ] as Awaited<ReturnType<typeof getChunks>>);
    const fallback = vi.fn(async () => "Текст из WebView");

    await analyzeBookCharacters(book, fallback);

    expect(fallback).not.toHaveBeenCalled();
    const [, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    const body = JSON.parse(String(request?.body));
    expect(body.messages[1].content).toContain("Глава из базы\nАнна вошла в комнату.");
    expect(body.messages[1].content).not.toContain("Текст из WebView");
    expect(request?.headers).toMatchObject({ accept: "text/event-stream" });
  });

  it("asks for appearance and age from the book text, not from adaptations", async () => {
    vi.mocked(getChunks).mockResolvedValueOnce([
      { chapterTitle: "Глава", content: "Текст" },
    ] as Awaited<ReturnType<typeof getChunks>>);

    await analyzeBookCharacters(book);

    const [, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    const systemPrompt = String(JSON.parse(String(request?.body)).messages[0].content);
    for (const field of ["appearancePrompt", "passport", "age", "build", "hair", "eyes", "face", "outfit"]) {
      expect(systemPrompt).toContain(field);
    }
    expect(systemPrompt).toContain("экранизаци");
  });

  it("loads and bounds a fallback sample when chunks are unavailable", async () => {
    vi.mocked(getChunks).mockResolvedValueOnce([]);
    const fallback = vi.fn(async () => "Начало ".repeat(10_000));

    await analyzeBookCharacters(book, fallback);

    expect(fallback).toHaveBeenCalledOnce();
    const [, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    const body = JSON.parse(String(request?.body));
    const userContent = String(body.messages[1].content);
    const excerpt = userContent.slice(userContent.indexOf("\n\n") + 2);
    expect(excerpt.length).toBeLessThanOrEqual(48_000);
    expect(excerpt).toContain("[…]");
  });

  it("reads an error body without cloning the response", async () => {
    vi.mocked(getChunks).mockResolvedValueOnce([
      { chapterTitle: "Глава", content: "Текст" },
    ] as Awaited<ReturnType<typeof getChunks>>);
    const response = new Response(JSON.stringify({ error: "Сервис недоступен" }), { status: 503 });
    const clone = vi.spyOn(response, "clone");
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(response);

    await expect(analyzeBookCharacters(book)).rejects.toThrow();

    expect(clone).not.toHaveBeenCalled();
  });
});
