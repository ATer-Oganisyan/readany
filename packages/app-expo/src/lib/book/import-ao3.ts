export const AO3_ORIGIN = "https://archiveofourown.org";

const AO3_HOSTS = new Set(["archiveofourown.org", "www.archiveofourown.org"]);

export type Ao3ImportErrorCode =
  | "ao3-work-link-required"
  | "ao3-blocked"
  | "ao3-not-found"
  | "ao3-network"
  | "ao3-parse";

export class Ao3ImportError extends Error {
  readonly code: Ao3ImportErrorCode;

  constructor(code: Ao3ImportErrorCode) {
    super(code);
    this.name = "Ao3ImportError";
    this.code = code;
  }
}

export interface Ao3Ref {
  workId: string;
}

export interface Ao3ImportResult {
  epubBytes: Uint8Array;
  fileName: string;
}

export interface Ao3FetchOptions {
  fetchImpl?: typeof globalThis.fetch;
}

function ao3Url(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== "https:" || !AO3_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

export function isAo3Url(rawUrl: string): boolean {
  return ao3Url(rawUrl) !== null;
}

export function parseAo3Url(rawUrl: string): Ao3Ref | null {
  const url = ao3Url(rawUrl);
  if (!url) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const worksIndex = segments.indexOf("works");
  const workId = worksIndex >= 0 ? segments[worksIndex + 1] : undefined;
  if (!/^\d+$/.test(workId ?? "")) return null;
  return { workId: workId as string };
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&amp;/g, "&");
}

function epubUrlFromWorkPage(html: string, workId: string): URL | null {
  const links = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of links) {
    const href = decodeHtmlEntities(match[1] ?? "");
    const label = (match[2] ?? "")
      .replace(/<[^>]+>/g, "")
      .trim()
      .toUpperCase();
    if (
      label !== "EPUB" ||
      !href.includes(`/downloads/${workId}/`) ||
      !/\.epub(?:\?|$)/i.test(href)
    ) {
      continue;
    }
    return new URL(href, AO3_ORIGIN);
  }
  return null;
}

async function defaultFetch(): Promise<typeof globalThis.fetch> {
  const { gatewayImportSourceFetch } = await import("./import-source-gateway");
  return gatewayImportSourceFetch as typeof globalThis.fetch;
}

function importErrorForStatus(status: number): Ao3ImportError {
  if (status === 403 || status === 429) return new Ao3ImportError("ao3-blocked");
  if (status === 404) return new Ao3ImportError("ao3-not-found");
  return new Ao3ImportError("ao3-network");
}

function safeEpubFileName(url: URL, workId: string): string {
  const raw = url.pathname.split("/").pop() ?? "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the encoded server filename if it is malformed.
  }
  const safe = decoded.replace(/[\\/:*?"<>|\[\]{}#%&]/g, "_").trim();
  return safe.toLowerCase().endsWith(".epub") ? safe : `ao3-${workId}.epub`;
}

export async function importAo3FromUrl(
  rawUrl: string,
  options: Ao3FetchOptions = {},
): Promise<Ao3ImportResult> {
  const ref = parseAo3Url(rawUrl);
  if (!ref) {
    throw new Ao3ImportError(isAo3Url(rawUrl) ? "ao3-work-link-required" : "ao3-parse");
  }

  const fetchImpl = options.fetchImpl ?? (await defaultFetch());
  const workUrl = `${AO3_ORIGIN}/works/${ref.workId}?view_adult=true`;
  let workResponse: Response;
  try {
    workResponse = await fetchImpl(workUrl);
  } catch {
    throw new Ao3ImportError("ao3-network");
  }
  if (!workResponse.ok) throw importErrorForStatus(workResponse.status);

  const epubUrl = epubUrlFromWorkPage(await workResponse.text(), ref.workId);
  if (!epubUrl) throw new Ao3ImportError("ao3-parse");

  let epubResponse: Response;
  try {
    epubResponse = await fetchImpl(epubUrl);
  } catch {
    throw new Ao3ImportError("ao3-network");
  }
  if (!epubResponse.ok) throw importErrorForStatus(epubResponse.status);

  const epubBytes = new Uint8Array(await epubResponse.arrayBuffer());
  if (
    epubBytes.length < 4 ||
    epubBytes[0] !== 0x50 ||
    epubBytes[1] !== 0x4b ||
    epubBytes[2] !== 0x03 ||
    epubBytes[3] !== 0x04
  ) {
    throw new Ao3ImportError("ao3-parse");
  }

  return {
    epubBytes,
    fileName: safeEpubFileName(epubUrl, ref.workId),
  };
}
