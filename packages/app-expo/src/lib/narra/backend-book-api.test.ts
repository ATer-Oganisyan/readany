import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BackendBookBinding,
  advanceBackendReaderProgress,
  fetchBackendBookManifest,
  fetchBackendCatalogBooks,
  fetchBackendCatalogBooksPage,
  publishLocalBackendMarkup,
  registerLocalBackendBook,
  requestBackendBookScene,
  resolveLocalBackendBook,
  uploadLocalBackendSource,
} from "./backend-book-api";
import type { NarraServiceError } from "./errors";
import type { NarraCharacter } from "./types";

vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ narraGatewayRequest: vi.fn() }));

describe("backend book API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads only complete downloadable records from the backend catalog", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              resolution: "catalog",
              book_edition_id: "book-1",
              catalog_key: "seagull",
              title: "Чайка",
              author: "Антон Чехов",
              format: "epub",
              content_sha256: "a".repeat(64),
              ready: true,
              source_download_path: "/v2/books/book-1/source/download",
              cover: {
                content_hash: "b".repeat(64),
                mime_type: "image/jpeg",
                byte_size: 42,
                download_path: "/v2/books/book-1/cover/download",
              },
            },
            { resolution: "catalog", catalog_key: "incomplete" },
          ],
        }),
      ),
    );

    await expect(fetchBackendCatalogBooks()).resolves.toEqual([
      expect.objectContaining({
        bookEditionId: "book-1",
        catalogKey: "seagull",
        title: "Чайка",
        sourceDownloadPath: "/v2/books/book-1/source/download",
        cover: {
          contentHash: "b".repeat(64),
          mimeType: "image/jpeg",
          byteSize: 42,
          downloadPath: "/v2/books/book-1/cover/download",
        },
      }),
    ]);
    expect(vi.mocked(narraGatewayRequest)).toHaveBeenCalledWith("/v2/books/catalog?limit=100", {});
  });

  it("loads one catalog page with an opaque cursor", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              resolution: "catalog",
              book_edition_id: "book-1",
              catalog_key: "seagull",
              title: "Чайка",
              author: "Антон Чехов",
              format: "epub",
              content_sha256: "a".repeat(64),
              ready: true,
              source_download_path: "/v2/books/book-1/source/download",
            },
          ],
          next_cursor: "next/catalog+cursor",
        }),
      ),
    );

    await expect(
      fetchBackendCatalogBooksPage({ limit: 24, cursor: "current/catalog+cursor" }),
    ).resolves.toEqual({
      books: [expect.objectContaining({ bookEditionId: "book-1", catalogKey: "seagull" })],
      nextCursor: "next/catalog+cursor",
    });
    expect(vi.mocked(narraGatewayRequest)).toHaveBeenCalledWith(
      "/v2/books/catalog?limit=24&cursor=current%2Fcatalog%2Bcursor",
      {},
    );
  });

  it("keeps the full-list contract by following every catalog cursor", async () => {
    const item = (id: string) => ({
      resolution: "catalog",
      book_edition_id: id,
      catalog_key: id,
      title: id,
      author: "",
      format: "epub",
      content_sha256: id === "book-1" ? "a".repeat(64) : "b".repeat(64),
      ready: true,
      source_download_path: `/v2/books/${id}/source/download`,
    });
    vi.mocked(narraGatewayRequest)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [item("book-1")], next_cursor: "cursor-2" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [item("book-1"), item("book-2")], next_cursor: null }),
        ),
      );

    await expect(fetchBackendCatalogBooks()).resolves.toEqual([
      expect.objectContaining({ bookEditionId: "book-1" }),
      expect.objectContaining({ bookEditionId: "book-2" }),
    ]);
    expect(vi.mocked(narraGatewayRequest)).toHaveBeenNthCalledWith(
      2,
      "/v2/books/catalog?limit=100&cursor=cursor-2",
      {},
    );
  });

  it("reports response metadata when the backend body is not JSON", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response("upstream unavailable", {
        status: 502,
        headers: { "content-type": "text/plain", "content-encoding": "identity" },
      }),
    );

    await expect(fetchBackendCatalogBooks()).rejects.toMatchObject({
      code: "SERVICE",
      technicalDetail: expect.stringContaining("HTTP 502; type=text/plain"),
    } satisfies Partial<NarraServiceError>);
  });

  it("resolves a local SHA-256 without sending book text", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resolution: "local_registration_required",
          content_sha256: "a".repeat(64),
          ready: false,
        }),
      ),
    );
    await expect(resolveLocalBackendBook("a".repeat(64))).resolves.toMatchObject({
      resolution: "local_registration_required",
      contentSha256: "a".repeat(64),
    });
    const [, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    expect(JSON.parse(String(request?.body))).toEqual({
      source: "local",
      content_sha256: "a".repeat(64),
    });
  });

  it("registers a local book using metadata only", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resolution: "private",
          book_edition_id: "book-1",
          content_sha256: "a".repeat(64),
          ready: false,
        }),
      ),
    );
    await registerLocalBackendBook(
      {
        id: "local-book",
        format: "epub",
        meta: { title: "Book", author: "Author" },
      } as never,
      "a".repeat(64),
    );
    const [path, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    expect(path).toBe("/v2/books/local");
    expect(JSON.parse(String(request?.body))).toEqual({
      content_sha256: "a".repeat(64),
      title: "Book",
      author: "Author",
      format: "epub",
    });
  });

  it("uploads private source bytes to start canonical v3", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resolution: "private",
          book_edition_id: "book-1",
          content_sha256: "a".repeat(64),
          generation_status: "marking_up",
          source_uploaded: true,
          ready: false,
        }),
        { status: 202 },
      ),
    );
    const result = await uploadLocalBackendSource(
      "book-1",
      new Uint8Array([1, 2, 3]),
      "application/epub+zip",
    );

    expect((result as BackendBookBinding & { sourceUploaded?: boolean }).sourceUploaded).toBe(true);
    const [path, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    expect(path).toBe("/v2/books/book-1/source");
    expect(request?.method).toBe("PUT");
    expect(new Headers(request?.headers).get("content-type")).toBe("application/epub+zip");
    expect(Array.from(request?.body as Uint8Array)).toEqual([1, 2, 3]);
  });

  it("publishes only derived character markup", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resolution: "private",
          book_edition_id: "book-1",
          content_sha256: "a".repeat(64),
          ready: true,
        }),
      ),
    );
    await publishLocalBackendMarkup("book-1", [
      {
        id: "анна",
        name: "Анна",
        fullName: "Анна Каренина",
        role: "героиня",
        gender: "female",
        voice: "Che",
        traits: ["смелая"],
        speechStyle: "",
        speechExamples: [],
        appearancePrompt: "",
        unlockProgress: 0.2,
      } as NarraCharacter,
    ]);
    const [path, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    expect(path).toBe("/v2/books/book-1/local-markup");
    const body = JSON.parse(String(request?.body));
    expect(body.characters[0]).toMatchObject({
      first_appearance_fraction: 0.2,
      warmup_fraction: 0.15,
    });
    expect(body.characters[0].character_key).toMatch(/^character-1-[a-f0-9]+$/);
    expect(body.characters[0].profile.clientCharacterId).toBe("анна");
    expect(JSON.stringify(body)).not.toContain("book text");
  });

  it("parses only reader-visible manifest characters and their download paths", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          availability: "ready",
          book: {
            resolution: "private",
            book_edition_id: "book-1",
            title: "Мертвое озеро",
            author: "Николай Некрасов",
            content_sha256: "a".repeat(64),
            ready: true,
          },
          reader_text_offset: 120,
          reading_fraction: 0.12,
          markup: { revision: 2, text_length: 1_000 },
          characters: [
            {
              character_key: "anna",
              name: "Анна",
              full_name: "Анна Каренина",
              first_appearance_text_offset: 100,
              state: "ready",
              profile: { role: "Героиня" },
              bundle: {
                version: "character-bundle-v1",
                assets: [
                  {
                    asset_id: "asset-1",
                    type: "primary_portrait",
                    content_hash: "b".repeat(64),
                    mime_type: "image/png",
                    byte_size: 42,
                    download_path: "/v2/books/book/media/asset-1/download",
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    const manifest = await fetchBackendBookManifest("book-1");
    expect(manifest.revision).toBe(2);
    expect(manifest.book?.title).toBe("Мертвое озеро");
    expect(manifest.textLength).toBe(1_000);
    expect(manifest.readingFraction).toBe(0.12);
    expect(manifest.characters[0]?.bundle?.assets[0]?.downloadPath).toBe(
      "/v2/books/book/media/asset-1/download",
    );
  });

  it("loads canonical v3 markup from the public manifest endpoint", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          source: "v3",
          availability: "ready",
          publication_id: "publication-v3",
          run_id: "run-v3",
          content_hash: "c".repeat(64),
          published_at: "2026-08-13T12:00:00.000Z",
          reader_text_offset: 900,
          reading_fraction: 0.45,
          markup: {
            schema_version: 3,
            analysis_version: "book-markup-v3",
            text_length: 2_000,
            scene_policy: {
              version: "text-interval-v1",
              start_text_offset: 0,
              interval_text_length: 6_000,
            },
          },
          characters: [
            {
              character_key: "rodion",
              name: "Раскольников",
              full_name: "Родион Романович Раскольников",
              first_appearance_text_offset: 100,
              state: "preparing",
              profile: { role: "Главный герой", analysisSource: "v3" },
              bundle: null,
            },
          ],
        }),
      ),
    );

    const manifest = await fetchBackendBookManifest("book-1");

    expect(vi.mocked(narraGatewayRequest)).toHaveBeenCalledWith("/v2/books/book-1/manifest", {});
    expect(manifest).toMatchObject({
      source: "v3",
      availability: "ready",
      publicationId: "publication-v3",
      analysisVersion: "book-markup-v3",
      scenePolicy: {
        version: "text-interval-v1",
        startTextOffset: 0,
        intervalTextLength: 6_000,
      },
    });
  });

  it("parses grounded provisional characters and scan progress from a processing manifest", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          source: "v3",
          availability: "processing",
          run_id: "run-v3",
          reader_text_offset: 240,
          reading_fraction: 0.12,
          analysis: {
            stage: "scan",
            status: "running",
            text_length: 2_000,
            completed_scan_chunks: 6,
            total_scan_chunks: 40,
          },
          markup: null,
          characters: [
            {
              character_key: "provisional:jane",
              name: "Jane",
              full_name: "Jane",
              first_appearance_text_offset: 100,
              provisional: true,
              state: "preparing",
              profile: { role: "Профиль формируется", provisional: true },
              bundle: null,
            },
          ],
        }),
        { status: 202 },
      ),
    );

    const manifest = await fetchBackendBookManifest("book-1");

    expect(manifest).toMatchObject({
      availability: "processing",
      runId: "run-v3",
      textLength: 2_000,
      analysis: {
        stage: "scan",
        completedScanChunks: 6,
        totalScanChunks: 40,
      },
      characters: [
        expect.objectContaining({ characterKey: "provisional:jane", provisional: true }),
      ],
    });
  });

  it("sends a clamped reading fraction for backend canonicalization", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(new Response("{}"));
    await advanceBackendReaderProgress("book-1", 1.2, "chapter-2", {
      sectionIndex: 4,
      sectionFraction: 0.25,
    });
    const [, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    expect(JSON.parse(String(request?.body))).toEqual({
      progress_fraction: 1,
      chapter_key: "chapter-2",
      section_index: 4,
      section_fraction: 0.25,
    });
  });

  it("requests a server-resolved scene without sending an excerpt", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "running",
          scene_key: "text-interval-v1:6",
          slot_index: 6,
          anchor_text_offset: 39_000,
          poll_after_ms: 1_500,
        }),
        { status: 202 },
      ),
    );

    await expect(requestBackendBookScene("book-1", 0.385)).resolves.toEqual({
      status: "running",
      sceneKey: "text-interval-v1:6",
      slotIndex: 6,
      anchorTextOffset: 39_000,
      imageUrl: undefined,
      mimeType: undefined,
      expiresAt: undefined,
      pollAfterMs: 1_500,
    });
    const [path, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    expect(path).toBe("/v2/books/book-1/scenes/at");
    expect(JSON.parse(String(request?.body))).toEqual({ progress_fraction: 0.385 });
  });

  it("retries reader progress without section fields during a rolling backend deploy", async () => {
    vi.mocked(narraGatewayRequest)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "body.section_index: unknown field" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response("{}"));

    await advanceBackendReaderProgress("book-1", 0.4, "chapter-2", {
      sectionIndex: 4,
      sectionFraction: 0.25,
    });

    expect(vi.mocked(narraGatewayRequest)).toHaveBeenCalledTimes(2);
    const [, fallbackRequest] = vi.mocked(narraGatewayRequest).mock.calls[1] ?? [];
    expect(JSON.parse(String(fallbackRequest?.body))).toEqual({
      progress_fraction: 0.4,
      chapter_key: "chapter-2",
    });
  });
});
