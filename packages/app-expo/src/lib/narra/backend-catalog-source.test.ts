import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendBookContentChunk, BackendCatalogBook } from "./backend-book-api";

const mocks = vi.hoisted(() => ({
  deleted: vi.fn(),
  fetchChunk: vi.fn(),
  files: new Map<string, string>(),
  hash: vi.fn(async () => "c".repeat(64)),
  moved: vi.fn(),
  writes: vi.fn(),
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  async digest(_algorithm: string, data: BufferSource) {
    const bytes = new Uint8Array(
      data instanceof ArrayBuffer ? data : data.buffer,
      data instanceof ArrayBuffer ? 0 : data.byteOffset,
      data instanceof ArrayBuffer ? data.byteLength : data.byteLength,
    );
    return new Uint8Array(32).fill(bytes[0] ?? 0).buffer;
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  EncodingType: { UTF8: "utf8" },
  async getInfoAsync(path: string) {
    if (path === "file:///documents/narra-catalog-content") {
      return { exists: true, isDirectory: true };
    }
    const text = mocks.files.get(path);
    return text === undefined
      ? { exists: false, isDirectory: false }
      : { exists: true, isDirectory: false, size: new TextEncoder().encode(text).byteLength };
  },
  makeDirectoryAsync: vi.fn(),
  async deleteAsync(path: string, options: unknown) {
    mocks.deleted(path, options);
    mocks.files.delete(path);
  },
  async writeAsStringAsync(path: string, text: string, options: { append?: boolean } = {}) {
    mocks.writes(path, text, options);
    mocks.files.set(path, options.append ? `${mocks.files.get(path) ?? ""}${text}` : text);
  },
  async readAsStringAsync(path: string) {
    const text = mocks.files.get(path);
    if (text === undefined) throw new Error("File not found");
    return text;
  },
  async moveAsync({ from, to }: { from: string; to: string }) {
    mocks.moved(from, to);
    const text = mocks.files.get(from);
    if (text !== undefined) mocks.files.set(to, text);
    mocks.files.delete(from);
  },
}));
vi.mock("./backend-book-api", () => ({ fetchBackendBookContentChunk: mocks.fetchChunk }));
vi.mock("./backend-file-hash", () => ({ sha256BackendFile: mocks.hash }));

import {
  appendBackendCatalogSource,
  cleanupBackendCatalogSource,
  downloadBackendCatalogSource,
  prepareBackendCatalogSource,
} from "./backend-catalog-source";

const BOOK: BackendCatalogBook = {
  resolution: "catalog",
  bookEditionId: "edition-1",
  catalogKey: "seagull",
  title: "Чайка",
  author: "Антон Чехов",
  format: "epub",
  contentSha256: "a".repeat(64),
  ready: true,
};

function fakeChunkHash(text: string): string {
  const firstByte = new TextEncoder().encode(text)[0] ?? 0;
  return firstByte.toString(16).padStart(2, "0").repeat(32);
}

function chunk({
  text,
  startByte,
  byteSize = 12,
  textLength = 6,
  contentHash = BOOK.contentSha256,
  nextCursor = null,
}: {
  text: string;
  startByte: number;
  byteSize?: number;
  textLength?: number;
  contentHash?: string;
  nextCursor?: string | null;
}): BackendBookContentChunk {
  const size = new TextEncoder().encode(text).byteLength;
  return {
    contractVersion: "book-content-v1",
    representation: "normalized-text-v1",
    bookEditionId: BOOK.bookEditionId,
    contentHash,
    textLength,
    byteSize,
    chunk: {
      startByte,
      endByteExclusive: startByte + size,
      contentHash: fakeChunkHash(text),
      text,
    },
    nextCursor,
  };
}

describe("backend catalog source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchChunk.mockReset();
    mocks.hash.mockReset();
    mocks.files.clear();
    mocks.hash.mockResolvedValue(BOOK.contentSha256);
  });

  it("downloads only the first UTF-8 chunk for the initial reader open", async () => {
    mocks.fetchChunk
      .mockResolvedValueOnce(chunk({ text: "При", startByte: 0, nextCursor: "opaque/next+1" }))
      .mockResolvedValueOnce(chunk({ text: "вет", startByte: 6 }));

    const prepared = await prepareBackendCatalogSource(BOOK);
    const path = prepared.filePath;

    expect(path).toBe("file:///documents/narra-catalog-content/seagull-edition-1.txt");
    expect(mocks.fetchChunk).toHaveBeenNthCalledWith(1, BOOK.bookEditionId, null);
    expect(mocks.fetchChunk).toHaveBeenCalledTimes(1);
    expect(mocks.files.get(path)).toBe("При");
    expect(prepared.state).toMatchObject({
      receivedBytes: 6,
      receivedTextLength: 3,
      byteSize: 12,
      nextCursor: "opaque/next+1",
    });
  });

  it("appends exactly one next chunk and verifies the whole text at the end", async () => {
    mocks.fetchChunk
      .mockResolvedValueOnce(chunk({ text: "При", startByte: 0, nextCursor: "opaque/next+1" }))
      .mockResolvedValueOnce(chunk({ text: "вет", startByte: 6 }));

    await prepareBackendCatalogSource(BOOK);
    const prepared = await appendBackendCatalogSource(BOOK);

    expect(mocks.fetchChunk).toHaveBeenNthCalledWith(2, BOOK.bookEditionId, "opaque/next+1");
    expect(mocks.files.get(prepared.filePath)).toBe("Привет");
    expect(prepared.state.nextCursor).toBeNull();
    expect(mocks.hash).toHaveBeenCalledWith(prepared.filePath);
  });

  it("drops partial data and restarts once when the content version changes", async () => {
    mocks.fetchChunk
      .mockResolvedValueOnce(
        chunk({ text: "а", startByte: 0, byteSize: 4, textLength: 2, nextCursor: "old-cursor" }),
      )
      .mockResolvedValueOnce(
        chunk({
          text: "б",
          startByte: 2,
          byteSize: 4,
          textLength: 2,
          contentHash: "d".repeat(64),
        }),
      )
      .mockResolvedValueOnce(chunk({ text: "да", startByte: 0, byteSize: 4, textLength: 2 }));

    await prepareBackendCatalogSource(BOOK);
    const prepared = await appendBackendCatalogSource(BOOK);

    expect(mocks.fetchChunk.mock.calls.map((call) => call[1])).toEqual([null, "old-cursor", null]);
    expect(mocks.files.get(prepared.filePath)).toBe("да");
  });

  it("deletes a partial file when a chunk checksum is invalid", async () => {
    const invalid = chunk({ text: "Привет", startByte: 0 });
    invalid.chunk.contentHash = "f".repeat(64);
    mocks.fetchChunk.mockResolvedValueOnce(invalid);

    await expect(downloadBackendCatalogSource(BOOK)).rejects.toThrow("chunk checksum mismatch");
    expect(mocks.files.has("file:///documents/narra-catalog-content/seagull-edition-1.txt")).toBe(
      false,
    );
  });

  it("stops repeated content cursors", async () => {
    mocks.fetchChunk
      .mockResolvedValueOnce(chunk({ text: "а", startByte: 0, byteSize: 6, nextCursor: "same" }))
      .mockResolvedValueOnce(chunk({ text: "б", startByte: 2, byteSize: 6, nextCursor: "same" }));

    await expect(downloadBackendCatalogSource(BOOK)).rejects.toThrow("cursor loop");
    expect(mocks.fetchChunk).toHaveBeenCalledTimes(2);
    expect(mocks.files.get("file:///documents/narra-catalog-content/seagull-edition-1.txt")).toBe(
      "а",
    );
  });

  it("only cleans up files from the private catalog cache", async () => {
    await cleanupBackendCatalogSource("file:///documents/user-book.epub");
    expect(mocks.deleted).not.toHaveBeenCalled();
  });
});
