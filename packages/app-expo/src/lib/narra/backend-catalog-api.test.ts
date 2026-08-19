import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBackendCatalogBooks, requestBackendDownloadUrl } from "./backend-catalog-api";

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

  it("loads only complete downloadable catalog records", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            resolution: "catalog",
            book_edition_id: "book-1",
            catalog_key: "seagull",
            title: "Чайка",
            author: "Антон Чехов",
            format: "epub",
            content_sha256: "a".repeat(64),
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
      }),
    );

    await expect(fetchBackendCatalogBooks()).resolves.toEqual([
      {
        resolution: "catalog",
        bookEditionId: "book-1",
        catalogKey: "seagull",
        title: "Чайка",
        author: "Антон Чехов",
        format: "epub",
        contentSha256: "a".repeat(64),
        sourceDownloadPath: "/v2/books/book-1/source/download",
        cover: {
          contentHash: "b".repeat(64),
          mimeType: "image/jpeg",
          byteSize: 123,
          downloadPath: "/v2/books/book-1/cover/download",
        },
      },
    ]);
    expect(narraGatewayRequest).toHaveBeenCalledWith("/v2/books/catalog?limit=100", {});
  });

  it("rejects a malformed top-level catalog payload", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(jsonResponse({ items: null }));
    await expect(fetchBackendCatalogBooks()).rejects.toThrow("некорректный каталог");
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
