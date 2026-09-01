import { BackendBookError } from "@/lib/narra/backend-book-api";
import { describe, expect, it, vi } from "vitest";
import { createBackendBookSearchTool, createNarraIndexedToolProvider } from "./narra-book-search";

vi.mock("@/lib/narra/backend-book-api", () => ({
  backendBookPath: (id: string, suffix: string) => `/v2/books/${encodeURIComponent(id)}/${suffix}`,
  backendBookRequest: vi.fn(),
  BackendBookError: class BackendBookError extends Error {
    constructor(public readonly status: number) {
      super(`HTTP ${status}`);
    }
  },
}));

describe("Narra server book search tool", () => {
  it("uses the ready backend index and preserves stable text offsets", async () => {
    const onPath = vi.fn();
    const request = vi.fn(async () => ({
      effective_mode: "hybrid",
      results: [
        {
          chunk_id: "chunk-1",
          chapter_key: "chapter-7",
          score: 0.75,
          matched_by: ["lexical", "semantic"],
          start_text_offset: 120,
          end_text_offset: 180,
          snippet: "Герой вернулся домой.",
        },
      ],
    }));
    const fallbackSearch = vi.fn();
    const tool = createBackendBookSearchTool({
      bookEditionId: "11111111-1111-4111-8111-111111111111",
      spoilerFree: true,
      fallbackSearch,
      onPath,
      request,
    });

    const result = await tool.execute({ query: "возвращение героя", topK: 5 });

    expect(request).toHaveBeenCalledWith(
      "/v2/books/11111111-1111-4111-8111-111111111111/search?q=%D0%B2%D0%BE%D0%B7%D0%B2%D1%80%D0%B0%D1%89%D0%B5%D0%BD%D0%B8%D0%B5+%D0%B3%D0%B5%D1%80%D0%BE%D1%8F&mode=hybrid&spoiler_mode=reader&limit=5",
    );
    expect(result).toMatchObject({
      source: "narra-server-index",
      effectiveMode: "hybrid",
      results: [
        {
          chapterKey: "chapter-7",
          startTextOffset: 120,
          endTextOffset: 180,
          content: "Герой вернулся домой.",
        },
      ],
    });
    expect(onPath).toHaveBeenCalledWith("index");
    expect(fallbackSearch).not.toHaveBeenCalled();
  });

  it("falls back to the original file when the server index is unavailable", async () => {
    const onPath = vi.fn();
    const fallbackSearch = vi.fn(async () => ({ results: [{ content: "local evidence" }] }));
    const tool = createBackendBookSearchTool({
      bookEditionId: "11111111-1111-4111-8111-111111111111",
      spoilerFree: false,
      fallbackSearch,
      onPath,
      request: vi.fn(async () => {
        throw new BackendBookError(409, { code: "SEARCH_NOT_READY" });
      }),
    });

    const result = await tool.execute({ query: "герой", topK: 3 });

    expect(fallbackSearch).toHaveBeenCalledWith({ query: "герой", topK: 3 });
    expect(result).toEqual({
      results: [{ content: "local evidence" }],
      retrievalPath: "proxy-fallback",
    });
    expect(onPath).toHaveBeenCalledWith("proxy-fallback");
  });

  it("does not hide installation authorization failures behind local fallback", async () => {
    const fallbackSearch = vi.fn();
    const tool = createBackendBookSearchTool({
      bookEditionId: "11111111-1111-4111-8111-111111111111",
      spoilerFree: false,
      fallbackSearch,
      onPath: vi.fn(),
      request: vi.fn(async () => {
        throw new BackendBookError(401, { code: "AUTH" });
      }),
    });

    await expect(tool.execute({ query: "герой" })).rejects.toMatchObject({ status: 401 });
    expect(fallbackSearch).not.toHaveBeenCalled();
  });

  it("keeps original-file tools beside the preferred server ragSearch", () => {
    const provider = createNarraIndexedToolProvider({
      bookId: "local-book",
      bookEditionId: "11111111-1111-4111-8111-111111111111",
      spoilerFree: true,
      onPath: vi.fn(),
    });

    const names = provider({
      bookId: "local-book",
      isVectorized: true,
      enabledSkills: [],
    }).map((tool) => tool.name);

    expect(names).toContain("ragSearch");
    expect(names).toContain("fallbackSearch");
    expect(names).toContain("fallbackChapterContext");
  });

  it("falls back from the server index to an existing local index before the original file", async () => {
    const onPath = vi.fn();
    const localRagSearch = vi.fn(async () => ({ results: [{ content: "indexed locally" }] }));
    const tool = createBackendBookSearchTool({
      bookEditionId: "11111111-1111-4111-8111-111111111111",
      spoilerFree: true,
      fallbackSearch: localRagSearch,
      fallbackPath: "index",
      onPath,
      request: vi.fn(async () => {
        throw new BackendBookError(409, { code: "SEARCH_NOT_READY" });
      }),
    });

    const result = await tool.execute({ query: "герой", mode: "bm25", topK: 3 });

    expect(onPath).toHaveBeenCalledWith("index");
    expect(localRagSearch).toHaveBeenCalledWith({ query: "герой", topK: 3 });
    expect(result).toMatchObject({ retrievalPath: "index" });
  });

  it("keeps one preferred ragSearch when both server and local indexes exist", () => {
    const provider = createNarraIndexedToolProvider({
      bookId: "local-book",
      bookEditionId: "11111111-1111-4111-8111-111111111111",
      spoilerFree: true,
      hasLocalIndex: true,
      onPath: vi.fn(),
    });

    const tools = provider({ bookId: "local-book", isVectorized: true, enabledSkills: [] });

    expect(tools.filter((tool) => tool.name === "ragSearch")).toHaveLength(1);
    expect(tools.map((tool) => tool.name)).toContain("ragToc");
    expect(tools.map((tool) => tool.name)).not.toContain("fallbackSearch");
  });
});
