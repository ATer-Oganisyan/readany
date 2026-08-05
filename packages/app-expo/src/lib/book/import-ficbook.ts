/**
 * Импорт фанфика с Фикбука (ficbook.net) по ссылке /readfic/<id>.
 *
 * Путь: скачиваем страницу фанфика (заголовок, автор, аннотация, обложка,
 * оглавление), затем главы по очереди (без параллели — антибот Фикбука
 * чувствителен к всплескам запросов), собираем валидный EPUB 2.0 через
 * buildStoreOnlyZip (тот же путь, что у TXT→EPUB конвертера). Аннотация
 * попадает в dc:description — штатный импорт кладёт её в book.meta.description
 * (используется анализом персонажей), главы становятся главами EPUB.
 *
 * Разметка проверена по живым страницам ficbook.net (август 2026):
 * - заголовок:  <h1 class="heading" itemprop="name|headline">…</h1>
 * - автор:      <a … itemprop="author">…</a> (атрибуты бывают с переносами строк)
 * - аннотация:  <div … itemprop="description">…</div>
 * - обложка:    <meta property="og:image" content="…fanfic-covers/…">
 *               (без обложки og:image указывает на дефолтную картинку сайта)
 * - оглавление: <ul class="list-of-fanfic-parts"> …
 *               <a href="/readfic/<id>/<part>#part_content" class="part-link">
 *               с <h3>названием главы</h3> внутри; одночастные фики оглавления
 *               не имеют — текст лежит прямо на странице фанфика
 * - текст:      <div id="content" … itemprop="articleBody">…</div>,
 *               абзацы разделены переводами строк, отступы — цепочки &nbsp;
 * - глава:      <h2 class="text-t1 …">название</h2> на странице главы
 *
 * Фикбук за Cloudflare: «голый» запрос без браузерных заголовков (и иногда
 * даже с ними — challenge) получает 403. Отдаём типизированную ошибку
 * "ficbook-blocked", UI показывает понятное сообщение.
 */

import { type ZipEntry, buildStoreOnlyZip } from "@readany/core/utils/store-only-zip";

export const FICBOOK_ORIGIN = "https://ficbook.net";

const FICBOOK_HOSTS = new Set(["ficbook.net", "www.ficbook.net", "m.ficbook.net"]);

/** Числовой id старых работ либо uuid новых. */
const FICBOOK_ID_PATTERN =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const REQUEST_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9",
};

/** Пауза между последовательными запросами глав — не дразнить антибот. */
const DEFAULT_CHAPTER_DELAY_MS = 400;

export type FicbookImportErrorCode =
  | "ficbook-blocked"
  | "ficbook-not-found"
  | "ficbook-network"
  | "ficbook-parse";

export class FicbookImportError extends Error {
  readonly code: FicbookImportErrorCode;

  constructor(code: FicbookImportErrorCode) {
    super(code);
    this.name = "FicbookImportError";
    this.code = code;
  }
}

export interface FicbookRef {
  workId: string;
  chapterId?: string;
}

export interface FicbookChapterRef {
  /** Абсолютный URL страницы главы. */
  url: string;
  title: string;
}

export interface FicbookWorkPage {
  title: string;
  author: string;
  description: string;
  /** URL обложки; null, если у фанфика нет своей обложки. */
  coverUrl: string | null;
  /** Оглавление многочастного фанфика; пусто у одночастных. */
  chapters: FicbookChapterRef[];
  /** Текст одночастного фанфика (страница работы содержит его сразу). */
  inlineChapter: FicbookChapter | null;
}

export interface FicbookChapter {
  title: string;
  paragraphs: string[];
}

export interface FicbookEpubInput {
  workId: string;
  title: string;
  author: string;
  description: string;
  language?: string;
  chapters: FicbookChapter[];
  cover?: { bytes: Uint8Array; mimeType: string } | null;
}

export interface FicbookImportResult {
  epubBytes: Uint8Array;
  fileName: string;
  title: string;
  author: string;
  chapterCount: number;
}

// ─── Определение ссылки ─────────────────────────────────────────────

/** Распознаёт ссылку на фанфик Фикбука; null для любых других URL. */
export function parseFicbookUrl(rawUrl: string): FicbookRef | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!FICBOOK_HOSTS.has(url.hostname.toLowerCase())) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2 || segments[0] !== "readfic") return null;

  const workId = segments[1] ?? "";
  if (!FICBOOK_ID_PATTERN.test(workId)) return null;

  const chapterId = segments[2];
  if (chapterId && FICBOOK_ID_PATTERN.test(chapterId)) {
    return { workId, chapterId };
  }
  return { workId };
}

// ─── HTML-помощники (без DOMParser — его нет в Hermes) ──────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function stripTagsToText(html: string): string {
  return decodeHtmlEntities(html.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, ""));
}

function collapseInline(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface DivBlock {
  /** Индекс `<` открывающего тега. */
  start: number;
  /** Индекс первого символа за закрывающим `</div>`. */
  end: number;
  innerStart: number;
  innerEnd: number;
}

/**
 * Находит первый div, у которого открывающий тег матчится маркером
 * (например, `id="content"`), и его границы. Считает вложенность div —
 * регулярным выражением до закрывающего тега здесь не добраться.
 */
function findDivBlock(html: string, openTagMarker: RegExp): DivBlock | null {
  const openMatch = openTagMarker.exec(html);
  if (!openMatch) return null;

  const contentStart = html.indexOf(">", openMatch.index);
  if (contentStart === -1) return null;

  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = contentStart + 1;
  let depth = 1;
  let tag = tagPattern.exec(html);
  while (tag) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return {
        start: openMatch.index,
        end: tag.index + tag[0].length,
        innerStart: contentStart + 1,
        innerEnd: tag.index,
      };
    }
    tag = tagPattern.exec(html);
  }
  return null;
}

/** innerHTML первого div, чей открывающий тег матчится маркером. */
export function extractDivInnerHtml(html: string, openTagMarker: RegExp): string | null {
  const block = findDivBlock(html, openTagMarker);
  return block ? html.slice(block.innerStart, block.innerEnd) : null;
}

const SERVICE_BLOCK_MARKER = /<div\b[^>]*class="[^"]*fanfic-text-promo[^"]*"[^>]*>/i;

/** Убирает служебные вставки Фикбука (промо внутри текста), если встретятся. */
function stripServiceBlocks(contentHtml: string): string {
  let result = contentHtml;
  for (;;) {
    const block = findDivBlock(result, SERVICE_BLOCK_MARKER);
    if (!block) return result;
    result = result.slice(0, block.start) + result.slice(block.end);
  }
}

/**
 * Текст главы → абзацы. На Фикбуке абзацы разделены переводами строк,
 * отступы сделаны цепочками &nbsp;.
 */
export function contentHtmlToParagraphs(contentHtml: string): string[] {
  const text = stripTagsToText(stripServiceBlocks(contentHtml));
  return text
    .split(/\r?\n/)
    .map((line) => collapseInline(line))
    .filter(Boolean);
}

function extractFirstTagText(html: string, tagPattern: RegExp): string | null {
  const match = tagPattern.exec(html);
  if (!match || match[1] === undefined) return null;
  const value = collapseInline(stripTagsToText(match[1]));
  return value || null;
}

// ─── Парсинг страниц ────────────────────────────────────────────────

/** Страница фанфика: шапка, аннотация, обложка, оглавление либо текст. */
export function parseFicbookWorkPage(html: string, workId: string): FicbookWorkPage {
  const title = extractFirstTagText(
    html,
    /<h1\b[^>]*class="[^"]*heading[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  if (!title) {
    throw new FicbookImportError("ficbook-parse");
  }

  const author =
    extractFirstTagText(html, /<a\b[^>]*itemprop="author"[^>]*>([\s\S]*?)<\/a>/i) ?? "";

  const descriptionHtml = extractDivInnerHtml(html, /<div\b[^>]*itemprop="description"[^>]*>/i);
  const description = descriptionHtml ? contentHtmlToParagraphs(descriptionHtml).join("\n") : "";

  const ogImage = /<meta\b[^>]*property="og:image"[^>]*content="([^"]+)"[^>]*>/i.exec(html)?.[1];
  const coverUrl = ogImage?.includes("fanfic-covers") ? decodeHtmlEntities(ogImage) : null;

  const chapters: FicbookChapterRef[] = [];
  const seen = new Set<string>();
  const partPattern = /<a\b([^>]*href="(\/readfic\/[^"#]+)#part_content"[^>]*)>([\s\S]*?)<\/a>/gi;
  let part = partPattern.exec(html);
  while (part) {
    const [, attrs = "", href = "", inner = ""] = part;
    // «Начать читать» тоже ведёт на #part_content — берём только элементы оглавления.
    if (attrs.includes("part-link") && href.includes(`/readfic/${workId}/`) && !seen.has(href)) {
      seen.add(href);
      const chapterTitle =
        extractFirstTagText(inner, /<h3\b[^>]*>([\s\S]*?)<\/h3>/i) ??
        collapseInline(stripTagsToText(inner));
      chapters.push({
        url: `${FICBOOK_ORIGIN}${href}`,
        title: chapterTitle || `Часть ${chapters.length + 1}`,
      });
    }
    part = partPattern.exec(html);
  }

  let inlineChapter: FicbookChapter | null = null;
  if (chapters.length === 0) {
    inlineChapter = parseFicbookChapterPage(html);
  }

  return {
    title,
    author,
    description,
    coverUrl,
    chapters,
    inlineChapter,
  };
}

/** Страница главы: название и абзацы текста. */
export function parseFicbookChapterPage(html: string): FicbookChapter {
  const contentHtml = extractDivInnerHtml(html, /<div\b[^>]*\bid="content"[^>]*>/i);
  if (contentHtml === null) {
    throw new FicbookImportError("ficbook-parse");
  }
  const title =
    extractFirstTagText(html, /<h2\b[^>]*class="[^"]*text-t1[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) ?? "";
  const paragraphs = contentHtmlToParagraphs(contentHtml);
  if (paragraphs.length === 0) {
    throw new FicbookImportError("ficbook-parse");
  }
  return { title, paragraphs };
}

// ─── Сборка EPUB ────────────────────────────────────────────────────

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function coverExtension(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

/**
 * Минимальный валидный EPUB 2.0: структура повторяет TxtToEpubConverter
 * (mimetype → container.xml → toc.ncx → главы → content.opf), плюс
 * dc:description с аннотацией и обложка с <meta name="cover">.
 */
export function buildFicbookEpub(input: FicbookEpubInput): Uint8Array {
  const encoder = new TextEncoder();
  const language = input.language ?? "ru";
  const identifier = `ficbook-${input.workId}`;
  const entries: ZipEntry[] = [];

  entries.push({ name: "mimetype", data: encoder.encode("application/epub+zip") });
  entries.push({
    name: "META-INF/container.xml",
    data: encoder.encode(
      '<?xml version="1.0" encoding="UTF-8"?>\n<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">\n  <rootfiles>\n    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>',
    ),
  });

  const navPoints = input.chapters
    .map(
      (chapter, i) =>
        `<navPoint id="navPoint-chapter${i + 1}" playOrder="${i + 1}">\n<navLabel><text>${escapeXml(chapter.title)}</text></navLabel>\n<content src="./OEBPS/chapter${i + 1}.xhtml" />\n</navPoint>`,
    )
    .join("\n");
  entries.push({
    name: "toc.ncx",
    data: encoder.encode(
      `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head>\n    <meta name="dtb:uid" content="${escapeXml(identifier)}" />\n    <meta name="dtb:depth" content="1" />\n    <meta name="dtb:totalPageCount" content="0" />\n    <meta name="dtb:maxPageNumber" content="0" />\n  </head>\n  <docTitle><text>${escapeXml(input.title)}</text></docTitle>\n  <docAuthor><text>${escapeXml(input.author)}</text></docAuthor>\n  <navMap>\n    ${navPoints}\n  </navMap>\n</ncx>`,
    ),
  });

  const css =
    "body { line-height: 1.6; font-size: 1em; text-align: justify; }\np { text-indent: 2em; margin: 0; }\nh2 { text-align: center; }";
  entries.push({ name: "style.css", data: encoder.encode(css) });

  for (const [i, chapter] of input.chapters.entries()) {
    const paragraphsXhtml = chapter.paragraphs.map((p) => `<p>${escapeXml(p)}</p>`).join("\n");
    const body = `<h2>${escapeXml(chapter.title)}</h2>\n${paragraphsXhtml}`;
    entries.push({
      name: `OEBPS/chapter${i + 1}.xhtml`,
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n<html xmlns="http://www.w3.org/1999/xhtml" lang="${language}" xml:lang="${language}">\n  <head>\n    <title>${escapeXml(chapter.title)}</title>\n    <link rel="stylesheet" type="text/css" href="../style.css"/>\n  </head>\n  <body>${body}</body>\n</html>`,
      ),
    });
  }

  let coverManifest = "";
  let coverMeta = "";
  if (input.cover) {
    const ext = coverExtension(input.cover.mimeType);
    entries.push({ name: `cover.${ext}`, data: input.cover.bytes });
    coverManifest = `<item id="cover-image" href="cover.${ext}" media-type="${escapeXml(input.cover.mimeType)}"/>\n      `;
    coverMeta = `<meta name="cover" content="cover-image"/>\n    `;
  }

  const manifest = input.chapters
    .map(
      (_, i) =>
        `<item id="chap${i + 1}" href="OEBPS/chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join("\n      ");
  const spine = input.chapters.map((_, i) => `<itemref idref="chap${i + 1}"/>`).join("\n      ");
  const descriptionXml = input.description
    ? `\n    <dc:description>${escapeXml(input.description)}</dc:description>`
    : "";

  entries.push({
    name: "content.opf",
    data: encoder.encode(
      `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="2.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:title>${escapeXml(input.title)}</dc:title>\n    <dc:language>${language}</dc:language>\n    <dc:creator>${escapeXml(input.author)}</dc:creator>\n    <dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>${descriptionXml}\n    ${coverMeta}</metadata>\n  <manifest>\n      ${coverManifest}${manifest}\n      <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n      <item id="css" href="style.css" media-type="text/css"/>\n  </manifest>\n  <spine toc="ncx">\n      ${spine}\n  </spine>\n</package>`,
    ),
  });

  return buildStoreOnlyZip(entries);
}

// ─── Сетевая оркестрация ────────────────────────────────────────────

export interface FicbookFetchOptions {
  fetchImpl?: typeof globalThis.fetch;
  /** Пауза между запросами глав; в тестах передавайте 0. */
  chapterDelayMs?: number;
}

async function resolveFetch(options: FicbookFetchOptions): Promise<typeof globalThis.fetch> {
  if (options.fetchImpl) return options.fetchImpl;
  // expo/fetch — WinterCG-совместимый fetch Expo (стриминг, arrayBuffer);
  // импорт ленивый, чтобы модуль оставался чистым для юнит-тестов.
  const { fetch: expoFetch } = await import("expo/fetch");
  return expoFetch as unknown as typeof globalThis.fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFicbookHtml(fetchImpl: typeof globalThis.fetch, url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: REQUEST_HEADERS });
  } catch {
    throw new FicbookImportError("ficbook-network");
  }
  if (response.status === 403 || response.status === 429) {
    throw new FicbookImportError("ficbook-blocked");
  }
  if (response.status === 404) {
    throw new FicbookImportError("ficbook-not-found");
  }
  if (!response.ok) {
    throw new FicbookImportError("ficbook-network");
  }
  return await response.text();
}

async function fetchCover(
  fetchImpl: typeof globalThis.fetch,
  coverUrl: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  try {
    const response = await fetchImpl(coverUrl, { headers: REQUEST_HEADERS });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) return null;
    const contentType = response.headers.get("content-type");
    const mimeType =
      contentType?.split(";")[0]?.trim() ||
      (coverUrl.endsWith(".png")
        ? "image/png"
        : coverUrl.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg");
    return { bytes, mimeType };
  } catch {
    // Обложка — не повод ронять импорт.
    return null;
  }
}

function sanitizeFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|\[\]{}#%&]/g, "_").trim();
  return `${safe || "ficbook"}.epub`;
}

/**
 * Полный импорт: страница фанфика → главы по очереди → EPUB-байты.
 * Бросает FicbookImportError с кодами ficbook-blocked / ficbook-not-found /
 * ficbook-network / ficbook-parse.
 */
export async function importFicbookFromUrl(
  rawUrl: string,
  options: FicbookFetchOptions = {},
): Promise<FicbookImportResult> {
  const ref = parseFicbookUrl(rawUrl);
  if (!ref) {
    throw new FicbookImportError("ficbook-parse");
  }

  const fetchImpl = await resolveFetch(options);
  const chapterDelayMs = options.chapterDelayMs ?? DEFAULT_CHAPTER_DELAY_MS;

  const workUrl = `${FICBOOK_ORIGIN}/readfic/${ref.workId}`;
  const workHtml = await fetchFicbookHtml(fetchImpl, workUrl);
  const work = parseFicbookWorkPage(workHtml, ref.workId);

  const chapters: FicbookChapter[] = [];
  if (work.inlineChapter) {
    chapters.push(work.inlineChapter);
  } else {
    // Последовательно, с паузой: параллельная качка глав — верный путь под 429.
    for (const [index, chapterRef] of work.chapters.entries()) {
      if (index > 0 && chapterDelayMs > 0) {
        await sleep(chapterDelayMs);
      }
      const chapterHtml = await fetchFicbookHtml(fetchImpl, chapterRef.url);
      const chapter = parseFicbookChapterPage(chapterHtml);
      chapters.push({
        title: chapter.title || chapterRef.title,
        paragraphs: chapter.paragraphs,
      });
    }
  }

  if (chapters.length === 0) {
    throw new FicbookImportError("ficbook-parse");
  }

  const cover = work.coverUrl ? await fetchCover(fetchImpl, work.coverUrl) : null;

  const epubBytes = buildFicbookEpub({
    workId: ref.workId,
    title: work.title,
    author: work.author,
    description: work.description,
    chapters,
    cover,
  });

  return {
    epubBytes,
    fileName: sanitizeFileName(work.title),
    title: work.title,
    author: work.author,
    chapterCount: chapters.length,
  };
}
