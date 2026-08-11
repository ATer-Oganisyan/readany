import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceBackendReaderProgress,
  fetchBackendBookManifest,
  publishLocalBackendMarkup,
  registerLocalBackendBook,
  resolveLocalBackendBook,
} from "./backend-book-api";
import type { NarraCharacter } from "./types";

vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ narraGatewayRequest: vi.fn() }));

describe("backend book API", () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(manifest.textLength).toBe(1_000);
    expect(manifest.readingFraction).toBe(0.12);
    expect(manifest.characters[0]?.bundle?.assets[0]?.downloadPath).toBe(
      "/v2/books/book/media/asset-1/download",
    );
  });

  it("sends a clamped reading fraction for backend canonicalization", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(new Response("{}"));
    await advanceBackendReaderProgress("book-1", 1.2, "chapter-2");
    const [, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    expect(JSON.parse(String(request?.body))).toEqual({
      progress_fraction: 1,
      chapter_key: "chapter-2",
    });
  });
});
