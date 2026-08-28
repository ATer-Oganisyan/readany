import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import type { Book } from "@readany/core/types";
import { type CatalogGenreId, parseCatalogGenres } from "./catalog-genres";
import { NarraServiceError } from "./errors";
import type { NarraCharacter } from "./types";

export type BackendBookResolution = "catalog" | "private" | "local_registration_required";
export type BackendManifestSource = "v2" | "v3";
export type BackendCatalogLanguage = "ru" | "en";

export interface BackendBookBinding {
  resolution: BackendBookResolution;
  bookEditionId?: string;
  catalogKey?: string;
  title?: string;
  author?: string;
  genres?: CatalogGenreId[];
  language?: string | null;
  format?: string;
  contentSha256: string;
  generationStatus?: string;
  ready: boolean;
  sourceDownloadPath?: string;
  sourceUploaded?: boolean;
  expiresAt?: string;
}

export interface BackendCatalogBook extends BackendBookBinding {
  resolution: "catalog";
  bookEditionId: string;
  catalogKey: string;
  title: string;
  author: string;
  format: string;
  sourceDownloadPath: string;
  cover?: {
    contentHash: string;
    mimeType: string;
    byteSize: number;
    downloadPath: string;
  };
}

export interface BackendCatalogPage {
  books: BackendCatalogBook[];
  nextCursor: string | null;
}

export interface BackendLanguageCatalogPage extends BackendCatalogPage {
  contractVersion: "book-catalog-language-v1";
  language: BackendCatalogLanguage;
}

export type BackendBookSearchMode = "hybrid" | "semantic" | "lexical";
export type BackendBookSpoilerMode = "reader" | "full";

export interface BackendBookGraphSearchResult {
  contractVersion: "book-graph-search-v1";
  bookEditionId: string;
  query: string;
  requestedMode: BackendBookSearchMode;
  effectiveMode: BackendBookSearchMode;
  spoilerMode: BackendBookSpoilerMode;
  maxTextOffset: number;
  state: string;
  contentResults: JsonRecord[];
  nodes: JsonRecord[];
  edges: JsonRecord[];
  storyArcs: JsonRecord[];
  evidence: JsonRecord[];
}

export interface BackendManifestAsset {
  assetId: string;
  type: "primary_portrait" | "greeting_audio" | "idle_animation";
  contentHash: string;
  mimeType: string;
  byteSize: number;
  downloadPath: string;
}

export interface BackendManifestCharacter {
  characterKey: string;
  name: string;
  fullName: string;
  firstAppearanceTextOffset: number;
  provisional?: boolean;
  state: "preparing" | "ready";
  profile: Record<string, unknown>;
  bundle: { version: string; assets: BackendManifestAsset[] } | null;
}

export interface BackendManifestAnalysis {
  stage: string;
  status: string;
  textLength?: number;
  completedScanChunks: number;
  totalScanChunks: number;
}

export interface BackendBookManifest {
  book?: BackendBookBinding;
  source: BackendManifestSource;
  availability: "processing" | "ready";
  readerTextOffset: number;
  readingFraction: number | null;
  textLength?: number;
  revision?: number;
  schemaVersion?: number;
  analysisVersion?: string;
  scenePolicy?: {
    version: string;
    startTextOffset: number;
    intervalTextLength: number;
  };
  publicationId?: string;
  runId?: string;
  contentHash?: string;
  publishedAt?: string;
  analysis?: BackendManifestAnalysis;
  characters: BackendManifestCharacter[];
}

export interface BackendReaderSectionPosition {
  sectionIndex: number;
  sectionFraction: number;
}

export interface BackendBookScene {
  status: "queued" | "running" | "ready" | "failed";
  sceneKey: string;
  slotIndex: number;
  anchorTextOffset: number;
  imageUrl?: string;
  mimeType?: string;
  expiresAt?: string;
  pollAfterMs: number;
}

export interface BackendBookIdentity {
  version: "book-identity-v1";
  bookEditionId: string;
  status: "processing" | "ready" | "failed";
  title?: string;
  author?: string;
  source?: "deterministic" | "llm";
  updatedAt?: string;
  pollAfterMs?: number;
  errorCode?: string;
}

type JsonRecord = Record<string, unknown>;

function normalizedBookLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized)) return null;
  const base = normalized.split("-", 1)[0];
  return /^[a-z]{2,3}$/.test(base) ? base : null;
}

function backendCharacterKey(value: string, index: number): string {
  const ascii = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  if (ascii) return ascii;
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `character-${index + 1}-${(hash >>> 0).toString(16)}`;
}

async function gatewayJson(path: string, init: RequestInit = {}): Promise<JsonRecord> {
  const response = await narraGatewayRequest(path, init);
  const text = await response.text();
  let payload: JsonRecord = {};
  try {
    payload = text ? (JSON.parse(text) as JsonRecord) : {};
  } catch {
    const contentType = response.headers.get("content-type") || "unknown";
    const contentEncoding = response.headers.get("content-encoding") || "identity";
    const preview = text.slice(0, 160).replace(/[\r\n\t]+/g, " ");
    throw new NarraServiceError(
      "SERVICE",
      "Backend вернул некорректный ответ",
      undefined,
      `HTTP ${response.status}; type=${contentType}; encoding=${contentEncoding}; body=${preview}`,
    );
  }
  if (!response.ok) {
    throw new NarraServiceError(
      response.status === 401 || response.status === 403 ? "AUTH" : "SERVICE",
      String(payload.error || payload.code || `HTTP ${response.status}`),
    );
  }
  return payload;
}

function binding(value: JsonRecord): BackendBookBinding {
  return {
    resolution: String(value.resolution) as BackendBookResolution,
    bookEditionId: typeof value.book_edition_id === "string" ? value.book_edition_id : undefined,
    catalogKey: typeof value.catalog_key === "string" ? value.catalog_key : undefined,
    title: typeof value.title === "string" ? value.title : undefined,
    author: typeof value.author === "string" ? value.author : undefined,
    genres: parseCatalogGenres(value.genres),
    language: normalizedBookLanguage(value.language),
    format: typeof value.format === "string" ? value.format : undefined,
    contentSha256: String(value.content_sha256 || ""),
    generationStatus:
      typeof value.generation_status === "string" ? value.generation_status : undefined,
    ready: value.ready === true,
    sourceDownloadPath:
      typeof value.source_download_path === "string" ? value.source_download_path : undefined,
    sourceUploaded: value.source_uploaded === true,
    expiresAt: typeof value.expires_at === "string" ? value.expires_at : undefined,
  };
}

function catalogBook(value: unknown): BackendCatalogBook | null {
  if (!value || typeof value !== "object") return null;
  const parsed = binding(value as JsonRecord);
  if (
    parsed.resolution !== "catalog" ||
    !parsed.bookEditionId ||
    !parsed.catalogKey ||
    !parsed.title ||
    !parsed.format ||
    !parsed.contentSha256 ||
    !parsed.sourceDownloadPath
  ) {
    return null;
  }
  const rawCover = (value as JsonRecord).cover;
  const coverValue = rawCover && typeof rawCover === "object" ? (rawCover as JsonRecord) : null;
  const cover =
    coverValue &&
    /^[a-f0-9]{64}$/.test(String(coverValue.content_hash || "")) &&
    typeof coverValue.mime_type === "string" &&
    Number.isSafeInteger(coverValue.byte_size) &&
    Number(coverValue.byte_size) > 0 &&
    typeof coverValue.download_path === "string" &&
    coverValue.download_path
      ? {
          contentHash: String(coverValue.content_hash),
          mimeType: String(coverValue.mime_type),
          byteSize: Number(coverValue.byte_size),
          downloadPath: String(coverValue.download_path),
        }
      : undefined;
  return {
    ...parsed,
    resolution: "catalog",
    bookEditionId: parsed.bookEditionId,
    catalogKey: parsed.catalogKey,
    title: parsed.title,
    author: parsed.author ?? "",
    format: parsed.format,
    sourceDownloadPath: parsed.sourceDownloadPath,
    cover,
  };
}

export async function fetchBackendCatalogBooksPage({
  limit = 24,
  cursor = null,
}: {
  limit?: number;
  cursor?: string | null;
} = {}): Promise<BackendCatalogPage> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Catalog page limit must be an integer from 1 to 100");
  }
  const query = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const payload = await gatewayJson(`/v2/books/catalog?${query}`);
  if (!Array.isArray(payload.items)) {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректный каталог");
  }
  if (
    payload.next_cursor !== undefined &&
    payload.next_cursor !== null &&
    typeof payload.next_cursor !== "string"
  ) {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректный cursor каталога");
  }
  const books = payload.items.flatMap((value) => {
    const book = catalogBook(value);
    return book ? [book] : [];
  });
  return {
    books,
    nextCursor: typeof payload.next_cursor === "string" ? payload.next_cursor : null,
  };
}

export async function fetchBackendCatalogBooksByLanguagePage(
  language: BackendCatalogLanguage,
  {
    limit = 24,
    cursor = null,
  }: {
    limit?: number;
    cursor?: string | null;
  } = {},
): Promise<BackendLanguageCatalogPage> {
  if (language !== "ru" && language !== "en") {
    throw new RangeError("Catalog language must be ru or en");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Catalog page limit must be an integer from 1 to 100");
  }
  const query = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const payload = await gatewayJson(`/v2/books/catalog/languages/${language}?${query}`);
  if (
    payload.contract_version !== "book-catalog-language-v1" ||
    payload.language !== language ||
    !Array.isArray(payload.items)
  ) {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректную языковую категорию");
  }
  if (
    payload.next_cursor !== undefined &&
    payload.next_cursor !== null &&
    typeof payload.next_cursor !== "string"
  ) {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректный cursor каталога");
  }
  const books = payload.items.flatMap((value) => {
    const book = catalogBook(value);
    return book?.language === language ? [book] : [];
  });
  if (books.length !== payload.items.length) {
    throw new NarraServiceError("SERVICE", "Backend смешал языки в категории каталога");
  }
  return {
    contractVersion: "book-catalog-language-v1",
    language,
    books,
    nextCursor: typeof payload.next_cursor === "string" ? payload.next_cursor : null,
  };
}

export async function fetchBackendCatalogBooksByLanguage(
  language: BackendCatalogLanguage,
): Promise<BackendCatalogBook[]> {
  const books: BackendCatalogBook[] = [];
  const bookIds = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await fetchBackendCatalogBooksByLanguagePage(language, { limit: 100, cursor });
    for (const book of page.books) {
      if (bookIds.has(book.bookEditionId)) continue;
      bookIds.add(book.bookEditionId);
      books.push(book);
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) {
      throw new NarraServiceError("SERVICE", "Backend зациклил cursor каталога");
    }
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return books;
}

export async function fetchBackendCatalogBooks(): Promise<BackendCatalogBook[]> {
  const books: BackendCatalogBook[] = [];
  const bookIds = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await fetchBackendCatalogBooksPage({ limit: 100, cursor });
    for (const book of page.books) {
      if (bookIds.has(book.bookEditionId)) continue;
      bookIds.add(book.bookEditionId);
      books.push(book);
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) {
      throw new NarraServiceError("SERVICE", "Backend зациклил cursor каталога");
    }
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return books;
}

export async function resolveLocalBackendBook(contentSha256: string): Promise<BackendBookBinding> {
  return binding(
    await gatewayJson("/v2/books/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "local", content_sha256: contentSha256 }),
    }),
  );
}

export async function registerLocalBackendBook(
  book: Book,
  contentSha256: string,
): Promise<BackendBookBinding> {
  const language = normalizedBookLanguage(book.meta.language);
  return binding(
    await gatewayJson("/v2/books/local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content_sha256: contentSha256,
        title: book.meta.title,
        author: book.meta.author || "",
        format: book.format,
        ...(language ? { language } : {}),
      }),
    }),
  );
}

export async function uploadLocalBackendSource(
  bookEditionId: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<BackendBookBinding> {
  return binding(
    await gatewayJson(`/v2/books/${encodeURIComponent(bookEditionId)}/source`, {
      method: "PUT",
      headers: { "content-type": mimeType },
      body: bytes as unknown as BodyInit,
    }),
  );
}

/** Lightweight polling that does not wait for the character markup manifest. */
export async function fetchBackendBookIdentity(
  bookEditionId: string,
): Promise<BackendBookIdentity> {
  const payload = await gatewayJson(`/v2/books/${encodeURIComponent(bookEditionId)}/identity`);
  const status = ["processing", "ready", "failed"].includes(String(payload.status))
    ? (String(payload.status) as BackendBookIdentity["status"])
    : "failed";
  return {
    version: "book-identity-v1",
    bookEditionId: String(payload.book_edition_id || bookEditionId),
    status,
    title: typeof payload.title === "string" ? payload.title : undefined,
    author: typeof payload.author === "string" ? payload.author : undefined,
    source:
      payload.source === "llm" || payload.source === "deterministic" ? payload.source : undefined,
    updatedAt: typeof payload.updated_at === "string" ? payload.updated_at : undefined,
    pollAfterMs:
      status === "processing" ? Math.max(250, Number(payload.poll_after_ms) || 2_000) : undefined,
    errorCode: typeof payload.error_code === "string" ? payload.error_code : undefined,
  };
}

export async function publishLocalBackendMarkup(
  bookEditionId: string,
  characters: NarraCharacter[],
): Promise<BackendBookBinding> {
  return binding(
    await gatewayJson(`/v2/books/${encodeURIComponent(bookEditionId)}/local-markup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        characters: characters.map((character, index) => ({
          character_key: backendCharacterKey(character.id, index),
          name: character.name,
          full_name: character.fullName,
          first_appearance_fraction: character.unlockProgress,
          warmup_fraction:
            Math.round(Math.max(0, character.unlockProgress - 0.05) * 1_000_000) / 1_000_000,
          profile: {
            clientCharacterId: character.id,
            role: character.role,
            gender: character.gender,
            voice: character.voice,
            traits: character.traits,
            speechStyle: character.speechStyle,
            speechExamples: character.speechExamples,
            appearancePrompt: character.appearancePrompt,
            passport: character.passport,
            expression: character.expression,
            greeting: character.greeting,
            isNarrator: character.isNarrator,
            unlockProgress: character.unlockProgress,
          },
        })),
      }),
    }),
  );
}

export async function advanceBackendReaderProgress(
  bookEditionId: string,
  progressFraction: number,
  chapterKey?: string,
  sectionPosition?: BackendReaderSectionPosition,
): Promise<void> {
  const path = `/v2/books/${encodeURIComponent(bookEditionId)}/progress`;
  const baseBody = {
    progress_fraction: Math.min(1, Math.max(0, progressFraction)),
    chapter_key: chapterKey || undefined,
  };
  const postProgress = (body: JsonRecord) =>
    gatewayJson(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  if (!sectionPosition) {
    await postProgress(baseBody);
    return;
  }

  try {
    await postProgress({
      ...baseBody,
      section_index: sectionPosition.sectionIndex,
      section_fraction: sectionPosition.sectionFraction,
    });
  } catch (error) {
    if (
      !(error instanceof NarraServiceError) ||
      !/section_(?:index|fraction).*unknown field/i.test(error.message)
    ) {
      throw error;
    }
    await postProgress(baseBody);
  }
}

export async function searchBackendBookGraph(
  bookEditionId: string,
  {
    query,
    mode = "hybrid",
    spoilerMode = "reader",
    limit = 8,
    maxHops = 2,
  }: {
    query: string;
    mode?: BackendBookSearchMode;
    spoilerMode?: BackendBookSpoilerMode;
    limit?: number;
    maxHops?: 1 | 2;
  },
): Promise<BackendBookGraphSearchResult> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2 || normalizedQuery.length > 500) {
    throw new RangeError("Book search query must contain 2-500 characters");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError("Book search limit must be an integer from 1 to 20");
  }
  if (maxHops !== 1 && maxHops !== 2) {
    throw new RangeError("Book graph maxHops must be 1 or 2");
  }
  const queryString = new URLSearchParams({
    q: normalizedQuery,
    mode,
    spoiler_mode: spoilerMode,
    limit: String(limit),
    max_hops: String(maxHops),
  }).toString();
  const payload = await gatewayJson(
    `/v2/books/${encodeURIComponent(bookEditionId)}/graph/search?${queryString}`,
  );
  const arrays = ["content_results", "nodes", "edges", "story_arcs", "evidence"] as const;
  if (
    payload.contract_version !== "book-graph-search-v1" ||
    payload.book_edition_id !== bookEditionId ||
    typeof payload.query !== "string" ||
    typeof payload.max_text_offset !== "number" ||
    arrays.some((key) => !Array.isArray(payload[key]))
  ) {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректный граф книги");
  }
  return {
    contractVersion: "book-graph-search-v1",
    bookEditionId,
    query: payload.query,
    requestedMode: String(payload.requested_mode) as BackendBookSearchMode,
    effectiveMode: String(payload.effective_mode) as BackendBookSearchMode,
    spoilerMode: String(payload.spoiler_mode) as BackendBookSpoilerMode,
    maxTextOffset: payload.max_text_offset,
    state: String(payload.state || ""),
    contentResults: payload.content_results as JsonRecord[],
    nodes: payload.nodes as JsonRecord[],
    edges: payload.edges as JsonRecord[],
    storyArcs: payload.story_arcs as JsonRecord[],
    evidence: payload.evidence as JsonRecord[],
  };
}

export async function fetchBackendBookManifest(
  bookEditionId: string,
): Promise<BackendBookManifest> {
  const encodedBookEditionId = encodeURIComponent(bookEditionId);
  const payload = await gatewayJson(`/v2/books/${encodedBookEditionId}/manifest`);
  const markup =
    payload.markup && typeof payload.markup === "object" ? (payload.markup as JsonRecord) : null;
  const analysis =
    payload.analysis && typeof payload.analysis === "object"
      ? (payload.analysis as JsonRecord)
      : null;
  const scenePolicy =
    markup?.scene_policy && typeof markup.scene_policy === "object"
      ? (markup.scene_policy as JsonRecord)
      : null;
  const rawCharacters = Array.isArray(payload.characters) ? payload.characters : [];
  const manifestBook =
    payload.book && typeof payload.book === "object"
      ? binding(payload.book as JsonRecord)
      : undefined;
  return {
    book: manifestBook?.bookEditionId ? manifestBook : undefined,
    source: payload.source === "v3" || payload.source === "shadow-v3" ? "v3" : "v2",
    availability: payload.availability === "ready" ? "ready" : "processing",
    readerTextOffset: Number(payload.reader_text_offset) || 0,
    readingFraction: typeof payload.reading_fraction === "number" ? payload.reading_fraction : null,
    textLength:
      (markup ? Number(markup.text_length) || undefined : undefined) ??
      (analysis ? Number(analysis.text_length) || undefined : undefined),
    revision: markup ? Number(markup.revision) || undefined : undefined,
    schemaVersion: markup ? Number(markup.schema_version) || undefined : undefined,
    analysisVersion:
      markup && typeof markup.analysis_version === "string" ? markup.analysis_version : undefined,
    scenePolicy:
      scenePolicy &&
      typeof scenePolicy.version === "string" &&
      Number.isSafeInteger(scenePolicy.start_text_offset) &&
      Number.isSafeInteger(scenePolicy.interval_text_length)
        ? {
            version: scenePolicy.version,
            startTextOffset: Number(scenePolicy.start_text_offset),
            intervalTextLength: Number(scenePolicy.interval_text_length),
          }
        : undefined,
    publicationId: typeof payload.publication_id === "string" ? payload.publication_id : undefined,
    runId: typeof payload.run_id === "string" ? payload.run_id : undefined,
    contentHash: typeof payload.content_hash === "string" ? payload.content_hash : undefined,
    publishedAt: typeof payload.published_at === "string" ? payload.published_at : undefined,
    analysis: analysis
      ? {
          stage: String(analysis.stage || ""),
          status: String(analysis.status || ""),
          textLength: Number(analysis.text_length) || undefined,
          completedScanChunks: Number(analysis.completed_scan_chunks) || 0,
          totalScanChunks: Number(analysis.total_scan_chunks) || 0,
        }
      : undefined,
    characters: rawCharacters.flatMap((candidate): BackendManifestCharacter[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const character = candidate as JsonRecord;
      const rawBundle =
        character.bundle && typeof character.bundle === "object"
          ? (character.bundle as JsonRecord)
          : null;
      const assets = Array.isArray(rawBundle?.assets) ? rawBundle.assets : [];
      return [
        {
          characterKey: String(character.character_key),
          name: String(character.name),
          fullName: String(character.full_name),
          firstAppearanceTextOffset: Number(character.first_appearance_text_offset) || 0,
          provisional: character.provisional === true,
          state: character.state === "ready" ? "ready" : "preparing",
          profile:
            character.profile && typeof character.profile === "object"
              ? (character.profile as Record<string, unknown>)
              : {},
          bundle: rawBundle
            ? {
                version: String(rawBundle.version),
                assets: assets.flatMap((rawAsset): BackendManifestAsset[] => {
                  if (!rawAsset || typeof rawAsset !== "object") return [];
                  const asset = rawAsset as JsonRecord;
                  return [
                    {
                      assetId: String(asset.asset_id),
                      type: String(asset.type) as BackendManifestAsset["type"],
                      contentHash: String(asset.content_hash),
                      mimeType: String(asset.mime_type),
                      byteSize: Number(asset.byte_size) || 0,
                      downloadPath: String(asset.download_path),
                    },
                  ];
                }),
              }
            : null,
        },
      ];
    }),
  };
}

export async function requestBackendBookScene(
  bookEditionId: string,
  progressFraction: number,
): Promise<BackendBookScene> {
  const payload = await gatewayJson(`/v2/books/${encodeURIComponent(bookEditionId)}/scenes/at`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      progress_fraction: Math.min(1, Math.max(0, progressFraction)),
    }),
  });
  const status = ["queued", "running", "ready", "failed"].includes(String(payload.status))
    ? (String(payload.status) as BackendBookScene["status"])
    : "failed";
  return {
    status,
    sceneKey: String(payload.scene_key || ""),
    slotIndex: Number(payload.slot_index) || 0,
    anchorTextOffset: Number(payload.anchor_text_offset) || 0,
    imageUrl: typeof payload.image_url === "string" ? payload.image_url : undefined,
    mimeType: typeof payload.mime_type === "string" ? payload.mime_type : undefined,
    expiresAt: typeof payload.expires_at === "string" ? payload.expires_at : undefined,
    pollAfterMs: Math.max(250, Number(payload.poll_after_ms) || 2_000),
  };
}

export async function requestBackendDownloadUrl(downloadPath: string): Promise<string> {
  const payload = await gatewayJson(downloadPath);
  if (typeof payload.download_url !== "string" || !payload.download_url) {
    throw new NarraServiceError("SERVICE", "Backend не вернул ссылку на материал");
  }
  return payload.download_url;
}
