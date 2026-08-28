import type { BackendCatalogBook, BackendCatalogGenre } from "./backend-catalog-api";
import { normalizeBookLanguage } from "./book-language";
import type {
  CatalogMetadata,
  CatalogProgress,
  CatalogStorage,
  CatalogStoredPage,
} from "./catalog-store";

const CACHE_VERSION = 2;

export interface CatalogFileIO {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
}

type JsonRecord = Record<string, unknown>;

interface StoredMetadata extends CatalogMetadata {
  version: number;
  generation?: string;
}

interface ProgressManifest {
  version: number;
  generation: string;
  pageCount: number;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function validCursor(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function validGeneration(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

function readBook(value: unknown, legacy: boolean): BackendCatalogBook | null {
  const raw = record(value);
  if (!raw) return null;
  const genres = legacy ? [] : raw.genres;
  const generationStatus = legacy ? "legacy-cache" : raw.generationStatus;
  const ready = legacy ? true : raw.ready;
  if (
    raw.resolution !== "catalog" ||
    typeof raw.bookEditionId !== "string" ||
    !raw.bookEditionId ||
    typeof raw.catalogKey !== "string" ||
    !raw.catalogKey ||
    typeof raw.title !== "string" ||
    typeof raw.author !== "string" ||
    !Array.isArray(genres) ||
    !genres.every((genre) => typeof genre === "string" && genre.length > 0) ||
    typeof raw.format !== "string" ||
    typeof raw.contentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(raw.contentSha256) ||
    typeof generationStatus !== "string" ||
    typeof ready !== "boolean" ||
    typeof raw.sourceDownloadPath !== "string" ||
    !raw.sourceDownloadPath.startsWith("/v2/books/")
  ) {
    return null;
  }
  const cover = record(raw.cover);
  if (
    raw.cover !== undefined &&
    (!cover ||
      typeof cover.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(cover.contentHash) ||
      !["image/jpeg", "image/png", "image/webp"].includes(String(cover.mimeType)) ||
      !Number.isSafeInteger(cover.byteSize) ||
      Number(cover.byteSize) <= 0 ||
      typeof cover.downloadPath !== "string" ||
      !cover.downloadPath.startsWith("/v2/books/"))
  ) {
    return null;
  }
  return {
    resolution: "catalog",
    bookEditionId: raw.bookEditionId,
    catalogKey: raw.catalogKey,
    title: raw.title,
    author: raw.author,
    genres,
    language: normalizeBookLanguage(raw.language),
    format: raw.format,
    contentSha256: raw.contentSha256,
    generationStatus,
    ready,
    sourceDownloadPath: raw.sourceDownloadPath,
    ...(cover ? { cover: cover as unknown as BackendCatalogBook["cover"] } : {}),
  };
}

function readGenre(value: unknown): BackendCatalogGenre | null {
  const raw = record(value);
  return raw &&
    typeof raw.id === "string" &&
    raw.id.length > 0 &&
    typeof raw.labelRu === "string" &&
    typeof raw.labelEn === "string" &&
    Number.isSafeInteger(raw.order)
    ? { id: raw.id, labelRu: raw.labelRu, labelEn: raw.labelEn, order: Number(raw.order) }
    : null;
}

/** Invalid complete data must not silently become a truncated 'complete' catalog. */
function readMetadata(value: unknown): StoredMetadata | null {
  const raw = record(value);
  if (!raw || (raw.version !== CACHE_VERSION && raw.version !== 1) || !Array.isArray(raw.books))
    return null;
  const legacy = raw.version === 1;
  const books = raw.books.map((book) => readBook(book, legacy));
  if (books.some((book) => !book)) return null;
  const nextCursor = legacy ? null : raw.nextCursor;
  const rawGenres = legacy ? [] : raw.genres;
  const genreVersion = legacy ? null : raw.genreVersion;
  if (
    !validCursor(nextCursor) ||
    !Array.isArray(rawGenres) ||
    (genreVersion !== null && typeof genreVersion !== "string")
  ) {
    return null;
  }
  const genres = rawGenres.map(readGenre);
  if (genres.some((genre) => !genre)) return null;
  return {
    version: CACHE_VERSION,
    books: books as BackendCatalogBook[],
    nextCursor,
    genres: genres as BackendCatalogGenre[],
    genreVersion,
    ...(validGeneration(raw.generation) ? { generation: raw.generation } : {}),
  };
}

function metadataOnly(value: CatalogMetadata): CatalogMetadata {
  return {
    books: value.books.map((book) => {
      const {
        coverUri: _uri,
        coverLoadFailed: _failed,
        ...metadata
      } = book as BackendCatalogBook & {
        coverUri?: string;
        coverLoadFailed?: boolean;
      };
      return metadata;
    }),
    nextCursor: value.nextCursor,
    genres: value.genres,
    genreVersion: value.genreVersion,
  };
}

/**
 * A full v2 snapshot plus an append-only page journal. Both are metadata only:
 * opening a screen does not stat every cached image. The previous full snapshot
 * also survives a process interruption between the two rename operations.
 */
export function createCatalogFileStorage(io: CatalogFileIO, root: string): CatalogStorage {
  const catalogPath = `${root}/catalog.json`;
  const manifestPath = `${root}/progress.json`;
  const journalRoot = `${root}/pages`;
  let sequence = 0;

  async function readJson(path: string): Promise<unknown> {
    try {
      return JSON.parse(await io.read(path));
    } catch {
      return null;
    }
  }

  async function replaceJson(path: string, value: unknown, preserveBackup = false): Promise<void> {
    const temporary = `${path}.${Date.now()}-${++sequence}.tmp`;
    const backup = `${path}.previous`;
    await io.write(temporary, JSON.stringify(value));
    try {
      if (await io.exists(path)) {
        if (preserveBackup) {
          await io.remove(path);
        } else {
          await io.remove(backup);
          await io.move(path, backup);
        }
      }
      await io.move(temporary, path);
    } finally {
      await io.remove(temporary);
    }
  }

  async function readManifest(): Promise<ProgressManifest | null> {
    for (const path of [manifestPath, `${manifestPath}.previous`]) {
      const raw = record(await readJson(path));
      if (
        raw?.version === CACHE_VERSION &&
        validGeneration(raw.generation) &&
        Number.isSafeInteger(raw.pageCount) &&
        Number(raw.pageCount) >= 0 &&
        Number(raw.pageCount) <= 10_000
      ) {
        return {
          version: CACHE_VERSION,
          generation: raw.generation,
          pageCount: Number(raw.pageCount),
        };
      }
    }
    return null;
  }

  async function readProgress(manifest: ProgressManifest): Promise<CatalogProgress | null> {
    const booksById = new Map<string, BackendCatalogBook>();
    const requestedCursors: Array<string | null> = [];
    let nextCursor: string | null = null;
    let genres: BackendCatalogGenre[] = [];
    let genreVersion: string | null = null;
    let pageCount = 0;
    for (let index = 0; index < manifest.pageCount; index += 1) {
      const raw = record(await readJson(`${journalRoot}/${manifest.generation}/${index}.json`));
      const page = record(raw?.page);
      if (
        raw?.version !== CACHE_VERSION ||
        raw.generation !== manifest.generation ||
        raw.index !== index ||
        raw.cursor !== nextCursor ||
        !page ||
        (index > 0 && nextCursor === null)
      ) {
        break;
      }
      const parsed = readMetadata({
        version: CACHE_VERSION,
        books: page.items,
        nextCursor: page.nextCursor,
        genres: raw.genres,
        genreVersion: raw.genreVersion,
      });
      if (
        !parsed ||
        (parsed.nextCursor === null && index + 1 < manifest.pageCount) ||
        (parsed.nextCursor !== null &&
          (parsed.nextCursor === nextCursor || requestedCursors.includes(parsed.nextCursor)))
      ) {
        break;
      }
      for (const book of parsed.books) booksById.set(book.bookEditionId, book);
      requestedCursors.push(nextCursor);
      nextCursor = parsed.nextCursor;
      genres = parsed.genres;
      genreVersion = parsed.genreVersion;
      pageCount += 1;
    }
    return {
      generation: manifest.generation,
      pageCount,
      requestedCursors,
      books: Array.from(booksById.values()),
      nextCursor,
      genres,
      genreVersion,
    };
  }

  return {
    async read() {
      const primary = readMetadata(await readJson(catalogPath));
      const backup =
        primary?.nextCursor === null
          ? null
          : readMetadata(await readJson(`${catalogPath}.previous`));
      const stored = primary ?? backup;
      const completeStored =
        primary?.nextCursor === null ? primary : backup?.nextCursor === null ? backup : null;
      const complete = completeStored ? metadataOnly(completeStored) : null;
      const manifest = await readManifest();
      let progress =
        manifest && manifest.generation !== completeStored?.generation
          ? await readProgress(manifest)
          : null;
      // Older v2 versions overwrote catalog.json after every page. Preserve that
      // partial cache as a resumable generation without claiming it is complete.
      // A failed migration can leave an empty manifest; that must not hide the
      // valid legacy pages on the next offline launch.
      if ((!progress || progress.pageCount === 0) && stored?.nextCursor) {
        const generation = `legacy-${Date.now()}-${++sequence}`;
        progress = {
          ...metadataOnly(stored),
          generation,
          pageCount: 1,
          requestedCursors: [null],
        };
        try {
          await this.begin(generation);
          await this.append({
            generation,
            index: 0,
            cursor: null,
            page: { items: progress.books, nextCursor: progress.nextCursor },
            genres: progress.genres,
            genreVersion: progress.genreVersion,
          });
        } catch (cacheError) {
          // Reading useful cached books cannot depend on having writable space
          // for an optional journal migration.
          return { complete, progress, cacheError };
        }
      }
      return { complete, progress };
    },
    async begin(generation) {
      if (!validGeneration(generation)) throw new Error("Invalid catalog generation");
      await io.mkdir(root);
      await io.mkdir(`${journalRoot}/${generation}`);
      await replaceJson(manifestPath, { version: CACHE_VERSION, generation, pageCount: 0 });
      // These directories contain only our abandoned metadata pages, never books
      // or image files belonging to the user's library.
      for (const entry of await io.list(journalRoot)) {
        if (entry !== generation) await io.remove(`${journalRoot}/${entry}`);
      }
    },
    async append(page: CatalogStoredPage) {
      if (!validGeneration(page.generation)) throw new Error("Invalid catalog generation");
      const directory = `${journalRoot}/${page.generation}`;
      await io.mkdir(directory);
      const metadata = metadataOnly({
        books: page.page.items,
        nextCursor: page.page.nextCursor,
        genres: page.genres,
        genreVersion: page.genreVersion,
      });
      await replaceJson(`${directory}/${page.index}.json`, {
        version: CACHE_VERSION,
        ...page,
        page: { items: metadata.books, nextCursor: metadata.nextCursor },
      });
      await replaceJson(manifestPath, {
        version: CACHE_VERSION,
        generation: page.generation,
        pageCount: page.index + 1,
      });
    },
    async commit(catalog, generation) {
      if (catalog.nextCursor !== null) throw new Error("Cannot commit an incomplete catalog");
      await io.mkdir(root);
      // A corrupt/legacy partial primary must not replace a valid recovery copy
      // if the final rename is interrupted again.
      const current = readMetadata(await readJson(catalogPath));
      await replaceJson(
        catalogPath,
        { version: CACHE_VERSION, generation, ...metadataOnly(catalog) },
        !current || current.nextCursor !== null,
      );
      // Remove the backup pointer first. A crash after removing the primary
      // must not expose an abandoned earlier generation through its backup.
      await io.remove(`${manifestPath}.previous`);
      await io.remove(manifestPath);
      await io.remove(journalRoot);
    },
  };
}
