import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import type { Book } from "@readany/core/types";
import { NarraServiceError } from "./errors";

export type BackendBookResolution = "catalog" | "private" | "private_upload_required";

export interface BackendBookBinding {
  resolution: BackendBookResolution;
  bookEditionId?: string;
  contentSha256: string;
  generationStatus?: string;
  ready: boolean;
  sourceDownloadPath?: string;
}

export interface BackendUploadInstruction {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
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
  availability: "processing" | "ready";
  readerTextOffset: number;
  readingFraction: number | null;
  textLength?: number;
  revision?: number;
  characters: BackendManifestCharacter[];
}

type JsonRecord = Record<string, unknown>;

async function gatewayJson(path: string, init: RequestInit = {}): Promise<JsonRecord> {
  const response = await narraGatewayRequest(path, init);
  const text = await response.text();
  let payload: JsonRecord = {};
  try {
    payload = text ? (JSON.parse(text) as JsonRecord) : {};
  } catch {
    throw new NarraServiceError("SERVICE", "Backend вернул некорректный ответ");
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
    contentSha256: String(value.content_sha256 || ""),
    generationStatus:
      typeof value.generation_status === "string" ? value.generation_status : undefined,
    ready: value.ready === true,
    sourceDownloadPath:
      typeof value.source_download_path === "string" ? value.source_download_path : undefined,
  };
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

export async function beginPrivateBackendUpload(
  book: Book,
  contentSha256: string,
  byteSize: number,
): Promise<BackendBookBinding & { upload?: BackendUploadInstruction }> {
  const payload = await gatewayJson("/v2/books/private/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content_sha256: contentSha256,
      title: book.meta.title,
      author: book.meta.author || "",
      format: book.format,
      byte_size: byteSize,
    }),
  });
  const result = binding(payload) as BackendBookBinding & { upload?: BackendUploadInstruction };
  if (payload.upload && typeof payload.upload === "object") {
    const upload = payload.upload as JsonRecord;
    result.upload = {
      url: String(upload.url),
      method: "PUT",
      headers:
        upload.headers && typeof upload.headers === "object"
          ? Object.fromEntries(
              Object.entries(upload.headers as JsonRecord).map(([key, value]) => [
                key,
                String(value),
              ]),
            )
          : {},
      expiresAt: String(upload.expires_at || ""),
    };
  }
  return result;
}

export async function completePrivateBackendUpload(
  bookEditionId: string,
): Promise<BackendBookBinding> {
  return binding(
    await gatewayJson(`/v2/books/${encodeURIComponent(bookEditionId)}/upload-complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
}

export async function advanceBackendReaderProgress(
  bookEditionId: string,
  progressFraction: number,
  chapterKey?: string,
): Promise<void> {
  await gatewayJson(`/v2/books/${encodeURIComponent(bookEditionId)}/progress`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      progress_fraction: Math.min(1, Math.max(0, progressFraction)),
      chapter_key: chapterKey || undefined,
    }),
  });
}

export async function fetchBackendBookManifest(
  bookEditionId: string,
): Promise<BackendBookManifest> {
  const payload = await gatewayJson(`/v2/books/${encodeURIComponent(bookEditionId)}/manifest`);
  const markup =
    payload.markup && typeof payload.markup === "object" ? (payload.markup as JsonRecord) : null;
  const rawCharacters = Array.isArray(payload.characters) ? payload.characters : [];
  return {
    availability: payload.availability === "ready" ? "ready" : "processing",
    readerTextOffset: Number(payload.reader_text_offset) || 0,
    readingFraction: typeof payload.reading_fraction === "number" ? payload.reading_fraction : null,
    textLength: markup ? Number(markup.text_length) || undefined : undefined,
    revision: markup ? Number(markup.revision) || undefined : undefined,
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
