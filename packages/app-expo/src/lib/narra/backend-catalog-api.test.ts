import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchBackendCatalogGenres,
  fetchBackendCatalogPage,
  mergeBackendCatalogBooks,
  requestBackendDownloadUrl,
} from "./backend-catalog-api";

vi.mock("@/lib/ai/narra-gateway-fetch", () => ({
  narraGatewayRequest: vi.fn(),
}));

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("backend catalog API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads a contract-complete catalog page", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
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
    expect(narraGatewayRequest).toHaveBeenCalledWith("/v2/books/catalog?limit=24", {});
  });

  it("rejects a malformed top-level catalog payload", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(jsonResponse({ items: null }));
    await expect(fetchBackendCatalogPage()).rejects.toThrow("некорректный каталог");
  });

  it("passes an opaque encoded cursor to the next catalog page", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      jsonResponse({ items: [], next_cursor: null }),
    );
    await fetchBackendCatalogPage("opaque+/=");
    expect(narraGatewayRequest).toHaveBeenCalledWith(
      "/v2/books/catalog?limit=24&cursor=opaque%2B%2F%3D",
      {},
    );
  });

  it("deduplicates appended pages by book edition id", () => {
    const first = { bookEditionId: "book-1", title: "Старая" } as never;
    const updated = { bookEditionId: "book-1", title: "Новая" } as never;
    const second = { bookEditionId: "book-2", title: "Вторая" } as never;
    expect(mergeBackendCatalogBooks([first], [updated, second])).toEqual([updated, second]);
  });

  it("loads and sorts the backend genre catalog", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
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
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      jsonResponse({ download_url: "https://objects.example/book.epub" }),
    );
    await expect(requestBackendDownloadUrl("/v2/books/book-1/source/download")).resolves.toBe(
      "https://objects.example/book.epub",
    );
  });
});
