import { createHash } from "node:crypto";
import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBackendBookContent } from "./backend-book-content-download";

const files = new Map<string, string>();

const mocks = vi.hoisted(() => ({ narraGatewayRequest: vi.fn() }));

vi.mock("@/lib/ai/narra-gateway-fetch", () => ({
  narraGatewayRequest: mocks.narraGatewayRequest,
}));

vi.mock("@readany/core/services", () => ({ getPlatformService: () => ({}) }));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: async (_algorithm: string, data: Uint8Array) => {
    const digest = createHash("sha256").update(Buffer.from(data)).digest();
    return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
  },
}));

vi.mock("@dr.pogodin/react-native-fs", () => ({
  appendFile: async (path: string, contents: string) => {
    files.set(path, (files.get(path) ?? "") + contents);
  },
  hash: async (path: string) => sha256(files.get(path) ?? ""),
}));

vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  deleteAsync: async (path: string) => {
    files.delete(path);
  },
  getInfoAsync: async (path: string) => {
    if (path === "file:///cache/narra-catalog-content") return { exists: true, isDirectory: true };
    const value = files.get(path);
    if (value === undefined) return { exists: false, isDirectory: false };
    return { exists: true, isDirectory: false, size: Buffer.byteLength(value, "utf8") };
  },
  makeDirectoryAsync: async () => undefined,
  readAsStringAsync: async (path: string) => {
    const value = files.get(path);
    if (value === undefined) throw new Error("ENOENT");
    return value;
  },
  writeAsStringAsync: async (path: string, contents: string) => {
    files.set(path, contents);
  },
}));

function sha256(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

const BOOK = { bookEditionId: "book-1", catalogKey: "seagull" };
const FULL_TEXT = "Привет";
const HEAD = "При";
const TAIL = "вет";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function chunkPayload(
  text: string,
  startByte: number,
  nextCursor: string | null,
  contentHash = sha256(FULL_TEXT),
  byteSize = Buffer.byteLength(FULL_TEXT, "utf8"),
) {
  return {
    contract_version: "book-content-v1",
    representation: "normalized-text-v1",
    book_edition_id: BOOK.bookEditionId,
    content_hash: contentHash,
    text_length: FULL_TEXT.length,
    byte_size: byteSize,
    chunk: {
      start_byte: startByte,
      end_byte_exclusive: startByte + Buffer.byteLength(text, "utf8"),
      content_hash: sha256(text),
      text,
    },
    next_cursor: nextCursor,
  };
}

describe("backend book content download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    files.clear();
  });

  it("assembles chunks into a file and verifies every checksum", async () => {
    vi.mocked(narraGatewayRequest)
      .mockResolvedValueOnce(jsonResponse(chunkPayload(HEAD, 0, "cursor-2")))
      .mockResolvedValueOnce(jsonResponse(chunkPayload(TAIL, 6, null)));

    const seen: number[] = [];
    const result = await downloadBackendBookContent(BOOK, {
      onProgress: (written) => seen.push(written),
    });

    expect(files.get(result.filePath)).toBe(FULL_TEXT);
    expect(result.contentHash).toBe(sha256(FULL_TEXT));
    expect(result.byteSize).toBe(12);
    expect(seen).toEqual([6, 12]);
    // Дочитанная книга не оставляет за собой файл прогресса.
    expect([...files.keys()].some((key) => key.endsWith(".progress.json"))).toBe(false);
  });

  it("resumes from the last whole chunk instead of starting over", async () => {
    vi.mocked(narraGatewayRequest)
      .mockResolvedValueOnce(jsonResponse(chunkPayload(HEAD, 0, "cursor-2")))
      .mockRejectedValueOnce(new Error("network request failed"))
      .mockRejectedValueOnce(new Error("network request failed"))
      .mockRejectedValueOnce(new Error("network request failed"));

    await expect(downloadBackendBookContent(BOOK)).rejects.toThrow();
    expect(narraGatewayRequest).toHaveBeenCalledTimes(4);

    vi.mocked(narraGatewayRequest).mockReset();
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(jsonResponse(chunkPayload(TAIL, 6, null)));

    const result = await downloadBackendBookContent(BOOK);
    expect(files.get(result.filePath)).toBe(FULL_TEXT);
    // Первый чанк уже лежал на диске: повторно его не запрашивали.
    expect(narraGatewayRequest).toHaveBeenCalledTimes(1);
    expect(narraGatewayRequest).toHaveBeenCalledWith(
      "/v2/books/book-1/content/chunks?cursor=cursor-2",
      {},
    );
  });

  it("rejects a chunk whose checksum does not match its bytes", async () => {
    const payload = chunkPayload(HEAD, 0, null);
    payload.chunk.content_hash = "f".repeat(64);
    // Каждая попытка обязана получить свежий Response: тело читается один раз.
    vi.mocked(narraGatewayRequest).mockImplementation(async () => jsonResponse(payload));

    await expect(downloadBackendBookContent(BOOK)).rejects.toThrow("контрольной сумме");
  });

  it("restarts from the first chunk when the text version changed mid-download", async () => {
    const otherHash = sha256("Другая версия");
    vi.mocked(narraGatewayRequest)
      .mockResolvedValueOnce(jsonResponse(chunkPayload(HEAD, 0, "cursor-2")))
      // Вторая половина приходит уже от другой версии текста.
      .mockResolvedValueOnce(jsonResponse(chunkPayload(TAIL, 6, null, otherHash)))
      .mockResolvedValueOnce(jsonResponse(chunkPayload(HEAD, 0, "cursor-2")))
      .mockResolvedValueOnce(jsonResponse(chunkPayload(TAIL, 6, null)));

    const result = await downloadBackendBookContent(BOOK);
    expect(files.get(result.filePath)).toBe(FULL_TEXT);
    // Перезапуск начался с первого чанка, а не продолжил по старому курсору.
    expect(narraGatewayRequest).toHaveBeenNthCalledWith(3, "/v2/books/book-1/content/chunks", {});
  });
});
