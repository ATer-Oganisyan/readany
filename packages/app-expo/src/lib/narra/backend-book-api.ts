import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import type { Book } from "@readany/core/types";
import { NarraServiceError } from "./errors";
import type { NarraCharacter } from "./types";

export type BackendBookResolution = "catalog" | "private" | "local_registration_required";
export type BackendManifestSource = "v2" | "shadow-v3";

export interface BackendBookBinding {
  resolution: BackendBookResolution;
  bookEditionId?: string;
  catalogKey?: string;
  title?: string;
  author?: string;
  format?: string;
  contentSha256: string;
  generationStatus?: string;
  ready: boolean;
  sourceDownloadPath?: string;
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
  state: "preparing" | "ready";
  profile: Record<string, unknown>;
  bundle: { version: string; assets: BackendManifestAsset[] } | null;
}

export interface BackendBookManifest {
  source: BackendManifestSource;
  availability: "processing" | "ready";
  readerTextOffset: number;
  readingFraction: number | null;
  textLength?: number;
  revision?: number;
  schemaVersion?: number;
  analysisVersion?: string;
  publicationId?: string;
  runId?: string;
  contentHash?: string;
  publishedAt?: string;
  characters: BackendManifestCharacter[];
}

export interface BackendReaderSectionPosition {
  sectionIndex: number;
  sectionFraction: number;
}

type JsonRecord = Record<string, unknown>;

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
    format: typeof value.format === "string" ? value.format : undefined,
    contentSha256: String(value.content_sha256 || ""),
    generationStatus:
      typeof value.generation_status === "string" ? value.generation_status : undefined,
    ready: value.ready === true,
    sourceDownloadPath:
      typeof value.source_download_path === "string" ? value.source_download_path : undefined,
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

export async function fetchBackendCatalogBooks(): Promise<BackendCatalogBook[]> {
  const payload = await gatewayJson("/v2/books/catalog?limit=100");
  if (!Array.isArray(payload.items)) {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректный каталог");
  }
  return payload.items.flatMap((value) => {
    const book = catalogBook(value);
    return book ? [book] : [];
  });
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
  return binding(
    await gatewayJson("/v2/books/local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content_sha256: contentSha256,
        title: book.meta.title,
        author: book.meta.author || "",
        format: book.format,
      }),
    }),
  );
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

export async function fetchBackendBookManifest(
  bookEditionId: string,
  source: BackendManifestSource = "v2",
): Promise<BackendBookManifest> {
  const encodedBookEditionId = encodeURIComponent(bookEditionId);
  const path =
    source === "shadow-v3"
      ? `/v2/books/${encodedBookEditionId}/analysis-shadow/manifest`
      : `/v2/books/${encodedBookEditionId}/manifest`;
  const payload = await gatewayJson(path);
  const markup =
    payload.markup && typeof payload.markup === "object" ? (payload.markup as JsonRecord) : null;
  const rawCharacters = Array.isArray(payload.characters) ? payload.characters : [];
  return {
    source: payload.source === "shadow-v3" ? "shadow-v3" : "v2",
    availability:
      payload.source === "shadow-v3" || payload.availability === "ready" ? "ready" : "processing",
    readerTextOffset: Number(payload.reader_text_offset) || 0,
    readingFraction: typeof payload.reading_fraction === "number" ? payload.reading_fraction : null,
    textLength: markup ? Number(markup.text_length) || undefined : undefined,
    revision: markup ? Number(markup.revision) || undefined : undefined,
    schemaVersion: markup ? Number(markup.schema_version) || undefined : undefined,
    analysisVersion:
      markup && typeof markup.analysis_version === "string" ? markup.analysis_version : undefined,
    publicationId: typeof payload.publication_id === "string" ? payload.publication_id : undefined,
    runId: typeof payload.run_id === "string" ? payload.run_id : undefined,
    contentHash: typeof payload.content_hash === "string" ? payload.content_hash : undefined,
    publishedAt: typeof payload.published_at === "string" ? payload.published_at : undefined,
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

export async function requestBackendDownloadUrl(downloadPath: string): Promise<string> {
  const payload = await gatewayJson(downloadPath);
  if (typeof payload.download_url !== "string" || !payload.download_url) {
    throw new NarraServiceError("SERVICE", "Backend не вернул ссылку на материал");
  }
  return payload.download_url;
}
