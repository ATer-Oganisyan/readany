import { setNarraGatewayAdapter } from "@/lib/ai/narra-gateway-fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchBackendCatalogGenres,
  fetchBackendCatalogPage,
  mergeBackendCatalogBooks,
  requestBackendDownloadUrl,
} from "./backend-catalog-api";

vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

const adapter = vi.fn<(path: string, init: RequestInit) => Promise<Response>>();

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
