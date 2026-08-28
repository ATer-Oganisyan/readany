import { setNarraGatewayAdapter } from "@/lib/ai/narra-gateway-fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchBackendCatalogGenres,
  fetchBackendCatalogPage,
  fetchBackendLanguageCatalogPage,
  mergeBackendCatalogBooks,
  requestBackendDownloadUrl,
} from "./backend-catalog-api";

vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

const adapter = vi.fn<(path: string, init: RequestInit) => Promise<Response>>();

function languageBook(language?: unknown) {
  return {
    resolution: "catalog",
    book_edition_id: "language-book",
    catalog_key: "narra-en-misleading",
    title: "Русское название",
    author: "Author",
    genres: [],
    format: "epub",
    content_sha256: "a".repeat(64),
    generation_status: "published",
    ready: true,
    source_download_path: "/v2/books/language-book/source/download",
    ...(language !== undefined ? { language } : {}),
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("backend catalog API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setNarraGatewayAdapter(adapter);
  });
  afterEach(() => setNarraGatewayAdapter(null));

  it.each([undefined, null, "ru", "en", "de", "fil"])(
    "preserves explicit language %s without guessing from names/keys",
    async (language) => {
      adapter.mockResolvedValueOnce(
        jsonResponse({ items: [languageBook(language)], next_cursor: null }),
      );
      const result = await fetchBackendCatalogPage();
      expect(result.items[0].language).toBe(language ?? null);
    },
  );

  it.each(["ru", "en"] as const)(
    "loads the versioned %s route with an opaque cursor",
    async (language) => {
      adapter.mockResolvedValueOnce(
        jsonResponse({
          contract_version: "book-catalog-language-v1",
          language,
          items: [languageBook(language)],
          next_cursor: "next+/=",
        }),
      );
      const result = await fetchBackendLanguageCatalogPage(language, "old+/=", 100);
      expect(result.items[0].language).toBe(language);
      expect(result.nextCursor).toBe("next+/=");
      expect(adapter).toHaveBeenCalledWith(
        `/v2/books/catalog/languages/${language}?limit=100&cursor=old%2B%2F%3D`,
        { signal: expect.any(AbortSignal) },
      );
    },
  );

  it.each([
    { contract_version: "future" },
    { language: "en" },
    { items: [languageBook("en")] },
    { items: [languageBook()] },
    { items: [languageBook("ru"), {}] },
    { next_cursor: 42 },
  ])(
    "rejects an incompatible language page instead of publishing a partial/mixed catalog",
    async (change) => {
      adapter.mockResolvedValueOnce(
        jsonResponse({
          contract_version: "book-catalog-language-v1",
          language: "ru",
          items: [languageBook("ru")],
          next_cursor: null,
          ...change,
        }),
      );
      await expect(fetchBackendLanguageCatalogPage("ru")).rejects.toMatchObject({
        code: "SERVICE",
      });
    },
  );

  it("rejects unsupported language and bad limits before dispatch, and preserves cursor validation errors", async () => {
    await expect(fetchBackendLanguageCatalogPage("de" as "ru")).rejects.toMatchObject({
      code: "REQUEST",
    });
    await expect(fetchBackendLanguageCatalogPage("ru", undefined, 101)).rejects.toMatchObject({
      code: "REQUEST",
    });
    expect(adapter).not.toHaveBeenCalled();
    adapter.mockResolvedValueOnce(
      jsonResponse({ code: "VALIDATION", error: "Invalid cursor" }, 400),
    );
    await expect(fetchBackendLanguageCatalogPage("ru", "opaque")).rejects.toMatchObject({
      code: "REQUEST",
      backendCode: "VALIDATION",
    });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("loads a contract-complete catalog page", async () => {
    adapter.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            resolution: "catalog",
            book_edition_id: "book-1",
            catalog_key: "seagull",
            title: "Чайка",
            author: "Антон Чехов",
            genres: ["drama"],
            format: "epub",
            content_sha256: "a".repeat(64),
            generation_status: "base_ready",
            ready: true,
            source_download_path: "/v2/books/book-1/source/download",
            cover: {
              content_hash: "b".repeat(64),
              mime_type: "image/jpeg",
              byte_size: 123,
              download_path: "/v2/books/book-1/cover/download",
            },
          },
          { resolution: "catalog", catalog_key: "incomplete" },
        ],
        next_cursor: "cursor-2",
      }),
    );

    await expect(fetchBackendCatalogPage()).resolves.toEqual({
      items: [
        {
          resolution: "catalog",
          bookEditionId: "book-1",
          language: null,
          catalogKey: "seagull",
          title: "Чайка",
          author: "Антон Чехов",
          genres: ["drama"],
          format: "epub",
          contentSha256: "a".repeat(64),
          generationStatus: "base_ready",
          ready: true,
          sourceDownloadPath: "/v2/books/book-1/source/download",
          cover: {
            contentHash: "b".repeat(64),
            mimeType: "image/jpeg",
            byteSize: 123,
            downloadPath: "/v2/books/book-1/cover/download",
          },
        },
      ],
      nextCursor: "cursor-2",
    });
    expect(adapter).toHaveBeenCalledWith("/v2/books/catalog?limit=24", {
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects a malformed top-level catalog payload", async () => {
    adapter.mockResolvedValueOnce(jsonResponse({ items: null }));
    await expect(fetchBackendCatalogPage()).rejects.toThrow("некорректный каталог");
  });

  it("passes an opaque encoded cursor to the next catalog page", async () => {
    adapter.mockResolvedValueOnce(jsonResponse({ items: [], next_cursor: null }));
    await fetchBackendCatalogPage("opaque+/=");
    expect(adapter).toHaveBeenCalledWith("/v2/books/catalog?limit=24&cursor=opaque%2B%2F%3D", {
      signal: expect.any(AbortSignal),
    });
  });

  it("deduplicates appended pages by book edition id", () => {
    const first = { bookEditionId: "book-1", title: "Старая" } as never;
    const updated = { bookEditionId: "book-1", title: "Новая" } as never;
    const second = { bookEditionId: "book-2", title: "Вторая" } as never;
    expect(mergeBackendCatalogBooks([first], [updated, second])).toEqual([updated, second]);
  });

  it("loads and sorts the backend genre catalog", async () => {
    adapter.mockResolvedValueOnce(
      jsonResponse({
        version: "catalog-genres-v1",
        items: [
          { id: "fantasy", label_ru: "Фэнтези", label_en: "Fantasy", order: 2 },
          { id: "adventure", label_ru: "Приключения", label_en: "Adventure", order: 1 },
          { id: null },
        ],
      }),
    );
    await expect(fetchBackendCatalogGenres()).resolves.toEqual({
      version: "catalog-genres-v1",
      items: [
        { id: "adventure", labelRu: "Приключения", labelEn: "Adventure", order: 1 },
        { id: "fantasy", labelRu: "Фэнтези", labelEn: "Fantasy", order: 2 },
      ],
    });
  });

  it("resolves an authenticated backend download URL", async () => {
    adapter.mockResolvedValueOnce(
      jsonResponse({ download_url: "https://objects.example/book.epub" }),
    );
    await expect(requestBackendDownloadUrl("/v2/books/book-1/source/download")).resolves.toBe(
      "https://objects.example/book.epub",
    );
  });
  it("settles both metadata callers when cancelled after headers even if their bodies never arrive", async () => {
    const controller = new AbortController();
    adapter.mockImplementation(async () => new Response(new ReadableStream()));
    const page = fetchBackendCatalogPage(undefined, 24, controller.signal);
    const dictionary = fetchBackendCatalogGenres(controller.signal);
    const results = Promise.allSettled([page, dictionary]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(adapter.mock.calls.map(([path]) => path)).toEqual([
      "/v2/books/catalog?limit=24",
      "/v2/books/genres",
    ]);
    controller.abort();
    expect(await results).toEqual([
      { status: "rejected", reason: expect.objectContaining({ name: "AbortError" }) },
      { status: "rejected", reason: expect.objectContaining({ name: "AbortError" }) },
    ]);
    for (const [, init] of adapter.mock.calls) expect(init.signal?.aborted).toBe(true);
  });

  it("does not dispatch an already cancelled metadata request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchBackendCatalogPage(undefined, 24, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(adapter).not.toHaveBeenCalled();
  });
});
