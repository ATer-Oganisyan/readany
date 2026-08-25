import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import {
  type BackendBookContentChunk,
  type BackendCatalogBook,
  fetchBackendBookContentChunk,
} from "./backend-book-api";
import { sha256BackendFile } from "./backend-file-hash";
import { NarraServiceError } from "./errors";

const CONTENT_ROOT = `${FileSystem.documentDirectory}narra-catalog-content`;
const MAX_CONTENT_VERSION_RESTARTS = 1;

export type BackendCatalogContentBook = Pick<
  BackendCatalogBook,
  "bookEditionId" | "catalogKey" | "contentSha256"
>;

export interface BackendCatalogSourceState {
  contractVersion: "book-content-v1";
  representation: "normalized-text-v1";
  bookEditionId: string;
  catalogKey: string;
  contentHash: string;
  textLength: number;
  receivedTextLength: number;
  byteSize: number;
  receivedBytes: number;
  nextCursor: string | null;
  usedCursors: string[];
}

export interface PreparedBackendCatalogSource {
  filePath: string;
  state: BackendCatalogSourceState;
}

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
}

function sourceBase(book: Pick<BackendCatalogContentBook, "catalogKey" | "bookEditionId">): string {
  return `${CONTENT_ROOT}/${safePart(book.catalogKey)}-${safePart(book.bookEditionId)}`;
}

function sourcePath(book: Pick<BackendCatalogContentBook, "catalogKey" | "bookEditionId">): string {
  return `${sourceBase(book)}.txt`;
}

function statePath(book: Pick<BackendCatalogContentBook, "catalogKey" | "bookEditionId">): string {
  return `${sourceBase(book)}.json`;
}

async function ensureContentRoot(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CONTENT_ROOT);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CONTENT_ROOT, { intermediates: true });
  }
}

class ContentVersionChangedError extends Error {}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateChunk(
  response: BackendBookContentChunk,
  expectedOffset: number,
): Promise<Uint8Array> {
  const { chunk } = response;
  const bytes = new TextEncoder().encode(chunk.text);
  if (
    chunk.startByte !== expectedOffset ||
    chunk.endByteExclusive !== expectedOffset + bytes.byteLength ||
    chunk.endByteExclusive > response.byteSize
  ) {
    throw new Error("Backend catalog chunk offsets are not continuous");
  }
  const digest = bytesToHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  if (digest !== chunk.contentHash) {
    throw new Error("Backend catalog chunk checksum mismatch");
  }
  return bytes;
}

function sameContentVersion(
  state: BackendCatalogSourceState,
  current: BackendBookContentChunk,
): boolean {
  return (
    current.contractVersion === state.contractVersion &&
    current.representation === state.representation &&
    current.bookEditionId === state.bookEditionId &&
    current.contentHash === state.contentHash &&
    current.textLength === state.textLength &&
    current.byteSize === state.byteSize
  );
}

function isContentVersionChanged(error: unknown): boolean {
  return (
    error instanceof ContentVersionChangedError ||
    (error instanceof NarraServiceError && error.backendCode === "CONTENT_VERSION_CHANGED")
  );
}

function validPersistedState(value: unknown): value is BackendCatalogSourceState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<BackendCatalogSourceState>;
  return (
    state.contractVersion === "book-content-v1" &&
    state.representation === "normalized-text-v1" &&
    typeof state.bookEditionId === "string" &&
    typeof state.catalogKey === "string" &&
    typeof state.contentHash === "string" &&
    /^[a-f0-9]{64}$/.test(state.contentHash) &&
    Number.isSafeInteger(state.textLength) &&
    Number(state.textLength) >= 0 &&
    Number.isSafeInteger(state.receivedTextLength) &&
    Number(state.receivedTextLength) > 0 &&
    Number(state.receivedTextLength) <= Number(state.textLength) &&
    Number.isSafeInteger(state.byteSize) &&
    Number(state.byteSize) > 0 &&
    Number.isSafeInteger(state.receivedBytes) &&
    Number(state.receivedBytes) > 0 &&
    Number(state.receivedBytes) <= Number(state.byteSize) &&
    (state.nextCursor === null || typeof state.nextCursor === "string") &&
    Array.isArray(state.usedCursors) &&
    state.usedCursors.every((cursor) => typeof cursor === "string" && cursor.length > 0)
  );
}

async function persistState(
  book: Pick<BackendCatalogContentBook, "catalogKey" | "bookEditionId">,
  state: BackendCatalogSourceState,
): Promise<void> {
  const path = statePath(book);
  const temporaryPath = `${path}.tmp`;
  await FileSystem.writeAsStringAsync(temporaryPath, JSON.stringify(state), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await FileSystem.deleteAsync(path, { idempotent: true });
  await FileSystem.moveAsync({ from: temporaryPath, to: path });
}

async function removeSource(
  book: Pick<BackendCatalogContentBook, "catalogKey" | "bookEditionId">,
): Promise<void> {
  await Promise.all([
    FileSystem.deleteAsync(sourcePath(book), { idempotent: true }),
    FileSystem.deleteAsync(statePath(book), { idempotent: true }),
    FileSystem.deleteAsync(`${statePath(book)}.tmp`, { idempotent: true }),
  ]);
}

async function verifyCompleteSource(path: string, state: BackendCatalogSourceState): Promise<void> {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists || info.isDirectory || info.size !== state.byteSize) {
    throw new Error("Backend catalog content byte size mismatch");
  }
  if ((await sha256BackendFile(path)) !== state.contentHash) {
    throw new Error("Backend catalog content checksum mismatch");
  }
}

function stateFromFirstChunk(
  book: BackendCatalogContentBook,
  response: BackendBookContentChunk,
  receivedBytes: number,
): BackendCatalogSourceState {
  return {
    contractVersion: response.contractVersion,
    representation: response.representation,
    bookEditionId: response.bookEditionId,
    catalogKey: book.catalogKey,
    contentHash: response.contentHash,
    textLength: response.textLength,
    receivedTextLength: response.chunk.text.length,
    byteSize: response.byteSize,
    receivedBytes,
    nextCursor: response.nextCursor,
    usedCursors: response.nextCursor ? [response.nextCursor] : [],
  };
}

async function receiveFirstChunk(
  book: BackendCatalogContentBook,
): Promise<PreparedBackendCatalogSource> {
  const response = await fetchBackendBookContentChunk(book.bookEditionId, null);
  const bytes = await validateChunk(response, 0);
  const path = sourcePath(book);
  await FileSystem.writeAsStringAsync(path, response.chunk.text, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const state = stateFromFirstChunk(book, response, bytes.byteLength);
  if (state.receivedBytes === state.byteSize) {
    if (state.nextCursor) {
      throw new Error("Backend catalog content has a cursor past the end of the book");
    }
    if (state.receivedTextLength !== state.textLength) {
      throw new Error("Backend catalog content text length mismatch");
    }
    await verifyCompleteSource(path, state);
  } else {
    if (!state.nextCursor) {
      throw new Error("Backend catalog content ended before the declared byte size");
    }
    if (state.receivedTextLength >= state.textLength) {
      throw new Error("Backend catalog content has a cursor past the end of the book");
    }
  }
  await persistState(book, state);
  return { filePath: path, state };
}

/** Returns the persisted download state when its TXT prefix is still intact. */
export async function getBackendCatalogSourceState(
  book: BackendCatalogContentBook,
): Promise<PreparedBackendCatalogSource | null> {
  await ensureContentRoot();
  try {
    const serialized = await FileSystem.readAsStringAsync(statePath(book), {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const state: unknown = JSON.parse(serialized);
    if (
      !validPersistedState(state) ||
      state.bookEditionId !== book.bookEditionId ||
      state.catalogKey !== book.catalogKey
    ) {
      return null;
    }
    const path = sourcePath(book);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || info.isDirectory || info.size !== state.receivedBytes) return null;
    return { filePath: path, state };
  } catch {
    return null;
  }
}

/** Downloads only the first chunk so the reader can open without waiting for the whole book. */
export async function prepareBackendCatalogSource(
  book: BackendCatalogContentBook,
): Promise<PreparedBackendCatalogSource> {
  await ensureContentRoot();
  const existing = await getBackendCatalogSourceState(book);
  if (existing) return existing;
  await removeSource(book);
  try {
    return await receiveFirstChunk(book);
  } catch (error) {
    await removeSource(book);
    throw error;
  }
}

async function appendNextChunk(
  book: BackendCatalogContentBook,
  prepared: PreparedBackendCatalogSource,
): Promise<PreparedBackendCatalogSource> {
  const { filePath, state } = prepared;
  if (!state.nextCursor) return prepared;

  const requestCursor = state.nextCursor;
  const response = await fetchBackendBookContentChunk(book.bookEditionId, requestCursor);
  if (!sameContentVersion(state, response)) throw new ContentVersionChangedError();
  const bytes = await validateChunk(response, state.receivedBytes);
  const receivedBytes = state.receivedBytes + bytes.byteLength;
  const receivedTextLength = state.receivedTextLength + response.chunk.text.length;
  const nextCursor = response.nextCursor;
  if (nextCursor) {
    if (state.usedCursors.includes(nextCursor)) {
      throw new Error("Backend catalog content cursor loop");
    }
    if (receivedBytes >= response.byteSize || receivedTextLength >= response.textLength) {
      throw new Error("Backend catalog content has a cursor past the end of the book");
    }
  } else if (receivedBytes !== response.byteSize || receivedTextLength !== response.textLength) {
    throw new Error("Backend catalog content ended before the declared byte size");
  }

  await FileSystem.writeAsStringAsync(filePath, response.chunk.text, {
    encoding: FileSystem.EncodingType.UTF8,
    append: true,
  });

  const nextState: BackendCatalogSourceState = {
    ...state,
    receivedBytes,
    receivedTextLength,
    nextCursor,
    usedCursors: nextCursor ? [...state.usedCursors, nextCursor] : state.usedCursors,
  };
  if (!nextCursor) await verifyCompleteSource(filePath, nextState);
  await persistState(book, nextState);
  return { filePath, state: nextState };
}

/** Fetches exactly one additional chunk and persists its opaque cursor for the next reading step. */
export async function appendBackendCatalogSource(
  book: BackendCatalogContentBook,
): Promise<PreparedBackendCatalogSource> {
  for (let restart = 0; restart <= MAX_CONTENT_VERSION_RESTARTS; restart += 1) {
    const prepared = await prepareBackendCatalogSource(book);
    try {
      return await appendNextChunk(book, prepared);
    } catch (error) {
      if (restart < MAX_CONTENT_VERSION_RESTARTS && isContentVersionChanged(error)) {
        await removeSource(book);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Backend catalog content version changed repeatedly");
}

/** Compatibility helper for flows that explicitly need a complete normalized TXT file. */
export async function downloadBackendCatalogSource(
  book: BackendCatalogContentBook,
): Promise<string> {
  let prepared = await prepareBackendCatalogSource(book);
  while (prepared.state.nextCursor) {
    prepared = await appendBackendCatalogSource(book);
  }
  return prepared.filePath;
}

export async function cleanupBackendCatalogSource(filePath: string | null): Promise<void> {
  if (!filePath || !filePath.startsWith(CONTENT_ROOT)) return;
  const base = filePath.replace(/\.txt$/, "");
  await Promise.all([
    FileSystem.deleteAsync(`${base}.txt`, { idempotent: true }),
    FileSystem.deleteAsync(`${base}.json`, { idempotent: true }),
    FileSystem.deleteAsync(`${base}.json.tmp`, { idempotent: true }),
  ]);
}
