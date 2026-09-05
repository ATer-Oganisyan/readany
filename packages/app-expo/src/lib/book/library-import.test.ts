import type { Book } from "@readany/core/types";
import { buildStoreOnlyZip } from "@readany/core/utils/store-only-zip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  insertBook: vi.fn(),
  updateBook: vi.fn(),
  deleteBook: vi.fn(),
  getBook: vi.fn(),
  getBooks: vi.fn(),
  getGroups: vi.fn(),
  getDeletedBookByFileHash: vi.fn(),
  hash: vi.fn(),
  metadata: vi.fn(),
  generateIdentity: vi.fn(),
  backend: vi.fn(),
  preserveOriginal: vi.fn(),
  setOriginal: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
  persisted: new Map<string, string>(),
  convertTxt: vi.fn(),
  convertUmd: vi.fn(),
  nextId: 0,
  validateSource: vi.fn(),
  readableFile: vi.fn(),
  nativeStatMd5: undefined as string | undefined,
}));

vi.mock("@readany/core", async () => import("../../../../core/src/import/import-dedupe"));
vi.mock("@readany/core/db/database", () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
  insertBook: mocks.insertBook,
  updateBook: mocks.updateBook,
  deleteBook: mocks.deleteBook,
  getBook: mocks.getBook,
  getBooks: mocks.getBooks,
  getGroups: mocks.getGroups,
  getDeletedBookByFileHash: mocks.getDeletedBookByFileHash,
}));
vi.mock("@readany/core/utils", () => ({ generateId: () => `import-${++mocks.nextId}` }));
vi.mock("@readany/core/utils/txt-to-epub", () => ({
  TxtToEpubConverter: class {
    convertToBytes = mocks.convertTxt;
  },
}));
vi.mock("@readany/core/utils/umd-to-epub", () => ({
  UmdToEpubConverter: class {
    convertToBytes = mocks.convertUmd;
  },
}));
vi.mock("@readany/core/services", () => ({
  getPlatformService: () => ({
    getAppDataDir: async () => "file:///app",
    joinPath: async (...parts: string[]) => parts.join("/"),
    mkdir: async () => {},
    readFile: async (path: string) => {
      const bytes = mocks.files.get(path);
      if (!bytes) throw new Error(`File missing: ${path}`);
      return bytes;
    },
    writeFile: async (path: string, bytes: Uint8Array) => {
      mocks.files.set(path, bytes);
    },
    deleteFile: async (path: string) => {
      mocks.files.delete(path);
    },
  }),
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(public uri: string) {}
    get exists() {
      return mocks.files.has(this.uri);
    }
    delete() {
      mocks.files.delete(this.uri);
    }
    copy(destination: { uri: string }) {
      const bytes = mocks.files.get(this.uri);
      if (!bytes) throw new Error("Book copy failed");
      mocks.files.set(destination.uri, bytes.slice());
    }
    info() {
      return { exists: this.exists, size: mocks.files.get(this.uri)?.length ?? 0 };
    }
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  getInfoAsync: async (path: string) => ({
    exists: mocks.files.has(path),
    size: mocks.files.get(path)?.length ?? 0,
    isDirectory: false,
    md5: mocks.nativeStatMd5,
  }),
}));
vi.mock("react-native", () => ({ AppState: { addEventListener: vi.fn() } }));
vi.mock("@/lib/book/cover-display", () => ({ isLegacyGeneratedBookCover: () => false }));
vi.mock("@/lib/book/cover-job-repository", () => ({
  deleteLocalCoverJob: vi.fn(),
  getLocalCoverJob: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/book/cover-persistence", () => ({
  persistCoverFile: vi.fn(),
  verifyCoverPersistence: vi.fn(),
}));
vi.mock("@/lib/book/generate-book-cover", () => ({
  acknowledgeGeneratedBookCover: vi.fn(),
  generateBookCover: vi.fn(),
}));
vi.mock("@/lib/book/generate-book-title", () => ({
  generateBookIdentityWithGemini: mocks.generateIdentity,
  isSuspiciousBookTitle: (title: string) => title === "unknown",
  isTechnicalBookTitle: () => false,
}));
vi.mock("@/lib/book/metadata-extractor", () => ({
  validateBookImportSource: mocks.validateSource,
  createRangeReadableFile: mocks.readableFile,
  extractBookMetadata: mocks.metadata,
  extractBookMetadataFromFile: mocks.metadata,
}));
vi.mock("@/lib/catalog/bundled-book-definitions", () => ({
  shouldRefreshBundledCatalogCover: () => false,
}));
vi.mock("@/lib/catalog/bundled-books", () => ({
  findBundledCatalogBookByTitle: vi.fn(),
  installBundledCatalogCover: vi.fn(),
}));
vi.mock("@/lib/narra/backend-book-sync", () => ({
  startImportedBackendBook: mocks.backend,
  preserveBackendOriginalSource: mocks.preserveOriginal,
}));
vi.mock("@/lib/narra/backend-file-hash", () => ({ trySha256BackendFile: mocks.hash }));
vi.mock("@/lib/rag/auto-vectorize-service", () => ({ queueBook: vi.fn() }));
vi.mock("@/stores/narra-store", () => ({
  useNarraStore: {
    getState: () => ({
      books: {},
      _hasHydrated: true,
      setBackendOriginalSource: mocks.setOriginal,
    }),
  },
}));
vi.mock("@/stores/persist", () => ({ debouncedSave: mocks.save, loadFromFS: mocks.load }));
vi.mock("@/stores/vector-model-store", () => ({
  useVectorModelStore: { getState: () => ({ autoVectorizeOnImport: false }) },
}));

import { useLibraryStore } from "@/stores/library-store";

const bytes = (text: string) => new TextEncoder().encode(text);
const existing: Book = {
  id: "existing",
  filePath: "books/existing.epub",
  format: "epub",
  meta: { title: "Существующая книга", author: "Автор", coverUrl: "covers/existing.jpg" },
  fileHash: "same-file",
  progress: 0.63,
  currentCfi: "epubcfi(/6/4!/4/2)",
  tags: ["Читаю"],
  addedAt: 1,
  updatedAt: 1,
  isVectorized: true,
  vectorizeProgress: 1,
  syncStatus: "local",
};

describe("mobile library import persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSource.mockReset().mockResolvedValue(undefined);
    mocks.readableFile.mockImplementation(async (path: string) => {
      const content = mocks.files.get(path);
      if (!content) throw new Error(`Missing file ${path}`);
      return new Blob([new Uint8Array(content)]);
    });
    mocks.files.clear();
    mocks.persisted.clear();
    mocks.nextId = 0;
    mocks.nativeStatMd5 = undefined;
    useLibraryStore.setState({ books: [], isImporting: false, isLoaded: false });
    mocks.getBooks.mockResolvedValue([]);
    mocks.getGroups.mockResolvedValue([]);
    mocks.load.mockImplementation(async (key: string) => {
      const json = mocks.persisted.get(key);
      return json ? JSON.parse(json) : null;
    });
    mocks.save.mockImplementation((key: string, value: unknown) => {
      mocks.persisted.set(key, JSON.stringify(value));
    });
    mocks.insertBook.mockResolvedValue(undefined);
    mocks.updateBook.mockResolvedValue(undefined);
    mocks.deleteBook.mockReset().mockResolvedValue(undefined);
    mocks.getDeletedBookByFileHash.mockResolvedValue(null);
    mocks.hash.mockResolvedValue("new-file");
    mocks.metadata.mockResolvedValue({ title: "Новая книга", author: "Автор" });
    mocks.convertTxt.mockResolvedValue({
      epubBytes: bytes("converted EPUB"),
      bookTitle: "Текстовая книга",
    });
    mocks.convertUmd.mockResolvedValue({
      epubBytes: bytes("converted UMD"),
      bookTitle: "UMD книга",
    });
    mocks.files.set("file:///picked.epub", bytes("new EPUB"));
  });

  it("merges a narrow cover update without replacing newer metadata or progress", async () => {
    useLibraryStore.setState({ books: [structuredClone(existing)] });
    await useLibraryStore
      .getState()
      .updateBook(existing.id, { meta: { coverUrl: "covers/new.jpg" } });
    expect(useLibraryStore.getState().books[0]).toMatchObject({
      meta: {
        title: existing.meta.title,
        author: existing.meta.author,
        coverUrl: "covers/new.jpg",
      },
      progress: existing.progress,
      currentCfi: existing.currentCfi,
    });
    expect(mocks.updateBook).toHaveBeenCalledWith(existing.id, {
      meta: { coverUrl: "covers/new.jpg" },
    });
  });

  it("reuses identical SHA256 bytes even if the native stat also supplies a different MD5", async () => {
    const sha256 = "a".repeat(64);
    mocks.nativeStatMd5 = "b".repeat(32);
    mocks.hash.mockResolvedValue(sha256);
    const current = { ...structuredClone(existing), fileHash: sha256 };
    useLibraryStore.setState({ books: [current] });
    mocks.files.set(`file:///app/${current.filePath}`, bytes("new EPUB"));
    const pathsBefore = [...mocks.files.keys()];
    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
    expect(result.failures).toEqual([]);
    expect(result.imported[0]).toMatchObject({
      id: current.id,
      fileHash: sha256,
      filePath: current.filePath,
    });
    expect(mocks.insertBook).not.toHaveBeenCalled();
    expect([...mocks.files.keys()]).toEqual(pathsBefore);
    expect(mocks.hash).toHaveBeenCalledWith(`file:///app/${current.filePath}`);
  });

  it.each([
    ["unsupported.cbr", "UNSUPPORTED_FORMAT"],
    ["empty.epub", "EMPTY_SOURCE"],
    ["broken.epub", "CORRUPT_SOURCE"],
    ["broken.umd", "CORRUPT_SOURCE"],
    ["storage.epub", "STORAGE_FAILED"],
  ])("returns a structured failure category for %s", async (name, code) => {
    const uri = `file:///${name}`;
    mocks.files.set(uri, name === "empty.epub" ? new Uint8Array() : bytes("source"));
    if (name === "broken.epub") {
      const parser =
        await vi.importActual<typeof import("./metadata-extractor")>("./metadata-extractor");
      mocks.validateSource.mockImplementation(parser.validateBookImportSource);
    }
    if (name === "broken.umd")
      mocks.convertUmd.mockRejectedValueOnce(new Error("UMD: no chapters detected"));
    if (name === "storage.epub")
      mocks.insertBook.mockRejectedValueOnce(new Error("SQLite full /private/user/book"));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await useLibraryStore.getState().importBooks([{ uri, name }]);
      expect(result.failures).toEqual([expect.objectContaining({ name, code })]);
      expect(result.imported).toEqual([]);
      expect(useLibraryStore.getState().books).toEqual([]);
      if (code === "STORAGE_FAILED") {
        expect(error).toHaveBeenCalledWith(
          "[importBooks] Import failed:",
          { filename: name, code },
          expect.any(Error),
        );
      } else {
        expect(error).not.toHaveBeenCalled();
        expect(info).toHaveBeenCalledExactlyOnceWith("[importBooks] Source rejected:", {
          filename: name,
          code,
        });
        expect(JSON.stringify(info.mock.calls)).not.toContain(uri);
      }
    } finally {
      info.mockRestore();
      error.mockRestore();
    }
  });

  it.each(["08-story.fbz", "09-story.fb2.zip"])(
    "imports actual archived FB2 metadata through the library store: %s",
    async (name) => {
      const parser =
        await vi.importActual<typeof import("./metadata-extractor")>("./metadata-extractor");
      const source = buildStoreOnlyZip([
        {
          name: "nested/story.fb2",
          data: bytes(
            '<?xml version="1.0"?><FictionBook><description><title-info><book-title>Письмо из архива</book-title><author><first-name>Анна</first-name><last-name>Орлова</last-name></author><lang>ru</lang></title-info></description><body><section><p>Анна читает письмо.</p></section></body></FictionBook>',
          ),
        },
      ]);
      const uri = `file:///${name}`;
      mocks.files.set(uri, source);
      mocks.validateSource.mockImplementation(parser.validateBookImportSource);
      mocks.metadata.mockImplementation((input, format, fileName) =>
        input instanceof Uint8Array
          ? parser.extractBookMetadata(input, format, fileName)
          : parser.extractBookMetadataFromFile(input, format, fileName),
      );
      const result = await useLibraryStore.getState().importBooks([{ uri, name }]);
      expect(result.failures).toEqual([]);
      expect(result.imported).toHaveLength(1);
      expect(useLibraryStore.getState().books[0]).toMatchObject({
        format: "fbz",
        meta: { title: "Письмо из архива", author: "Анна Орлова", language: "ru" },
      });
      expect(mocks.insertBook.mock.calls[0]?.[0].meta).toMatchObject({
        title: "Письмо из архива",
        author: "Анна Орлова",
      });
      expect(mocks.readableFile).toHaveBeenCalledWith(uri, source.length);
    },
  );

  it("does not publish a book until its database insert succeeds", async () => {
    let complete!: () => void;
    mocks.insertBook.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = useLibraryStore.getState().addBook(existing);
    await vi.waitFor(() => expect(mocks.insertBook).toHaveBeenCalledOnce());
    expect(useLibraryStore.getState().books).toEqual([]);
    complete();
    await pending;
    expect(useLibraryStore.getState().books).toEqual([existing]);
  });

  it("reports storage failure and removes only this import's files", async () => {
    mocks.insertBook.mockRejectedValue(new Error("disk full"));
    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
    expect(result.imported).toEqual([]);
    expect(result.failures).toEqual([
      { name: "book.epub", error: "disk full", code: "STORAGE_FAILED" },
    ]);
    expect(useLibraryStore.getState().books).toEqual([]);
    expect([...mocks.files.keys()]).toEqual(["file:///picked.epub"]);
    expect(mocks.backend).not.toHaveBeenCalled();
  });

  it("leaves the old bytes, cover and reading progress intact when replacing an edition fails", async () => {
    const catalog = {
      ...existing,
      sourceKind: "catalog" as const,
      bookEditionId: "edition",
      contentHash: "old",
      syncStatus: "remote" as const,
    };
    useLibraryStore.setState({ books: [catalog] });
    mocks.files.set("file:///app/books/existing.epub", bytes("old EPUB"));
    mocks.files.set("file:///app/covers/existing.jpg", bytes("old cover"));
    mocks.hash.mockImplementation(async (path: string) =>
      path === "file:///picked.epub" ? "new-file" : "old-file",
    );
    mocks.updateBook.mockRejectedValue(new Error("disk full"));
    const result = await useLibraryStore.getState().importBooks([
      {
        uri: "file:///picked.epub",
        name: "book.epub",
        knownBook: {
          title: "Новая редакция",
          author: "Автор",
          sourceKind: "catalog",
          bookEditionId: "edition",
          contentHash: "new",
          revisionId: "new",
        },
      },
    ]);
    expect(result.imported).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(mocks.files.get("file:///app/books/existing.epub")).toEqual(bytes("old EPUB"));
    expect(mocks.files.get("file:///app/covers/existing.jpg")).toEqual(bytes("old cover"));
    expect(useLibraryStore.getState().books).toEqual([catalog]);
    expect(mocks.files.size).toBe(3);
  });

  it("finishes local import while AI identity is still pending", async () => {
    mocks.metadata.mockResolvedValue({ title: "unknown", author: "" });
    mocks.generateIdentity.mockReturnValue(new Promise(() => {}));
    const result = await Promise.race([
      useLibraryStore
        .getState()
        .importBooks([{ uri: "file:///picked.epub", name: "unknown.epub" }]),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100)),
    ]);
    expect(result).not.toBe("blocked");
    expect(useLibraryStore.getState().books).toHaveLength(1);
  });

  it("rejects unsupported files before copying or registering them as EPUB", async () => {
    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "report.docx" }]);
    expect(result.imported).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(mocks.insertBook).not.toHaveBeenCalled();
    expect([...mocks.files.keys()]).toEqual(["file:///picked.epub"]);
  });

  it("does not delay deletion of an unrelated book behind an active import write", async () => {
    const other = { ...structuredClone(existing), id: "unrelated", fileHash: "other-hash" };
    useLibraryStore.setState({ books: [structuredClone(existing), other] });
    mocks.hash.mockResolvedValue("same-file");
    let release!: () => void;
    mocks.updateBook.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
    await vi.waitFor(() => expect(mocks.updateBook).toHaveBeenCalledOnce());
    try {
      await useLibraryStore.getState().removeBook(other.id);
      expect(mocks.deleteBook).toHaveBeenCalledExactlyOnceWith(other.id, { preserveData: false });
      expect(useLibraryStore.getState().isImporting).toBe(true);
    } finally {
      release();
      await pending;
    }
    expect(useLibraryStore.getState().books.map((book) => book.id)).toEqual([existing.id]);
  });

  it("does not turn deletion during source hashing into an unrelated new import", async () => {
    useLibraryStore.setState({ books: [structuredClone(existing)] });
    let release!: (hash: string) => void;
    mocks.hash.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const pending = useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
    await vi.waitFor(() => expect(mocks.hash).toHaveBeenCalledOnce());
    await useLibraryStore.getState().removeBook(existing.id);
    release("same-file");
    const result = await pending;
    expect(result.imported).toEqual([]);
    expect(useLibraryStore.getState().books).toEqual([]);
    expect(mocks.insertBook).not.toHaveBeenCalled();
    expect(mocks.updateBook).not.toHaveBeenCalled();
  });

  it.each([
    ["login.epub", "<!doctype html><html><body>Sign in to download</body></html>"],
    ["broken.fb2", '<?xml version="1.0"?><FictionBook><body><section><p>Unclosed'],
    ["broken.pdf", "%PDF-1.4\ntruncated"],
  ])("rejects actual damaged %s bytes without a phantom book", async (name, content) => {
    const parser =
      await vi.importActual<typeof import("./metadata-extractor")>("./metadata-extractor");
    const source = bytes(content);
    mocks.files.set("file:///picked.epub", source);
    mocks.metadata.mockImplementation(parser.extractBookMetadata);
    mocks.validateSource.mockImplementation(async (_file: unknown, format: string) => {
      await parser.validateBookImportSource(new Blob([source]), format);
    });
    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name }]);
    expect(result.imported).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(useLibraryStore.getState().books).toEqual([]);
    expect(mocks.insertBook).not.toHaveBeenCalled();
    expect(mocks.backend).not.toHaveBeenCalled();
    expect([...mocks.files.keys()]).toEqual(["file:///picked.epub"]);
  });

  it("imports filenames containing a literal percent sign", async () => {
    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "100% книга.epub" }]);
    expect(result.failures).toEqual([]);
    expect(result.imported).toHaveLength(1);
    expect(useLibraryStore.getState().isImporting).toBe(false);
  });

  it("preserves every reading locator and cached text count during reimport", async () => {
    const reading = { ...existing, nativeLocator: "native-v1:position", totalCharacters: 500_000 };
    useLibraryStore.setState({ books: [reading] });
    mocks.hash.mockResolvedValue("same-file");
    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]).toMatchObject({
      id: reading.id,
      progress: reading.progress,
      currentCfi: reading.currentCfi,
      nativeLocator: reading.nativeLocator,
      totalCharacters: reading.totalCharacters,
      tags: reading.tags,
    });
    expect(useLibraryStore.getState().books).toHaveLength(1);
  });

  it("accounts for all 25 repeated inputs as 17 refreshed and 8 failed, not 17 added", async () => {
    const books = Array.from({ length: 17 }, (_, index) => ({
      ...existing,
      id: `existing-${index}`,
      fileHash: `hash-${index}`,
    }));
    useLibraryStore.setState({ books });
    const files = Array.from({ length: 25 }, (_, index) => ({
      uri: `file:///repeat-${index}.epub`,
      name: index < 17 ? `repeat-${index}.epub` : `unsupported-${index}.cbr`,
    }));
    for (const file of files) mocks.files.set(file.uri, bytes("book"));
    mocks.hash.mockImplementation(async (uri: string) => `hash-${uri.match(/repeat-(\d+)/)?.[1]}`);
    const result = await useLibraryStore.getState().importBooks(files);
    expect(result.imported).toHaveLength(17); // Legacy inclusive contract.
    expect(result.refreshedCount).toBe(17);
    expect(result.imported.length - (result.refreshedCount ?? 0)).toBe(0);
    expect(result.skippedDuplicates).toHaveLength(0);
    expect(result.failures).toHaveLength(8);
    expect(result.imported.length + result.skippedDuplicates.length + result.failures.length).toBe(
      25,
    );
    expect(useLibraryStore.getState().books.map((book) => book.id)).toEqual(
      books.map((book) => book.id),
    );
    expect(mocks.insertBook).not.toHaveBeenCalled();
  });

  it("counts restoration of a deleted book as added, not refreshed", async () => {
    mocks.getDeletedBookByFileHash.mockResolvedValue({ ...existing, deletedAt: 20 });
    mocks.hash.mockResolvedValue("same-file");
    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
    expect(result.imported).toHaveLength(1);
    expect(result.refreshedCount ?? 0).toBe(0);
    expect(result.imported[0].id).toBe(existing.id);
    expect(useLibraryStore.getState().books).toHaveLength(1);
    expect(result.failures).toHaveLength(0);
  });

  it("does not report a failed refresh as updated", async () => {
    useLibraryStore.setState({ books: [existing] });
    mocks.hash.mockResolvedValue("same-file");
    mocks.updateBook.mockRejectedValue(new Error("disk full"));
    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
    expect(result.imported).toHaveLength(0);
    expect(result.refreshedCount ?? 0).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(useLibraryStore.getState().books[0]).toBe(existing);
  });

  it.each(["txt", "umd"])(
    "counts a refreshed %s conversion without changing the inclusive result",
    async (format) => {
      useLibraryStore.setState({ books: [existing] });
      mocks.hash.mockResolvedValue("same-file");
      const result = await useLibraryStore
        .getState()
        .importBooks([{ uri: "file:///picked.epub", name: `book.${format}` }]);
      expect(result.refreshedCount).toBe(1);
      expect(result.imported).toHaveLength(1);
      expect(result.imported[0]).toMatchObject({ id: existing.id, format: "epub" });
      expect(result.failures).toHaveLength(0);
    },
  );

  it("counts identical files within one batch as one added and one refreshed", async () => {
    const result = await useLibraryStore.getState().importBooks([
      { uri: "file:///picked.epub", name: "book.epub" },
      { uri: "file:///picked.epub", name: "renamed.epub" },
    ]);
    expect(result.imported).toHaveLength(2);
    expect(result.refreshedCount).toBe(1);
    expect(result.imported.length - (result.refreshedCount ?? 0)).toBe(1);
    expect(result.skippedDuplicates).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
    expect(useLibraryStore.getState().books).toHaveLength(1);
  });

  it.each([
    ["������", "����", "Письмо", "Анна"],
    ["Личное название", "Мой автор", "Личное название", "Мой автор"],
  ])(
    "reimport repairs only broken identity and retains manual identity: %s",
    async (oldTitle, oldAuthor, expectedTitle, expectedAuthor) => {
      const parser =
        await vi.importActual<typeof import("./metadata-extractor")>("./metadata-extractor");
      const xml =
        '<?xml version="1.0" encoding="windows-1251"?><FictionBook><description><title-info><book-title>Письмо</book-title><author><first-name>Анна</first-name></author></title-info></description><body><section><p>Анна читает письмо.</p></section></body></FictionBook>';
      const source = Uint8Array.from([...xml], (char) =>
        char.charCodeAt(0) >= 0x410 ? char.charCodeAt(0) - 0x410 + 0xc0 : char.charCodeAt(0),
      );
      const current: Book = {
        ...existing,
        format: "fb2",
        filePath: "books/existing.fb2",
        meta: { ...existing.meta, title: oldTitle, author: oldAuthor },
      };
      useLibraryStore.setState({ books: [current] });
      mocks.files.set("file:///picked.epub", source);
      mocks.hash.mockResolvedValue("same-file");
      mocks.metadata.mockImplementation(parser.extractBookMetadata);
      mocks.validateSource.mockImplementation(async () =>
        parser.validateBookImportSource(new Blob([source]), "fb2"),
      );
      const result = await useLibraryStore
        .getState()
        .importBooks([{ uri: "file:///picked.epub", name: "book.fb2" }]);
      expect(result.failures).toEqual([]);
      expect(result.imported).toHaveLength(1);
      expect(result.imported[0]).toMatchObject({
        id: current.id,
        progress: current.progress,
        currentCfi: current.currentCfi,
        meta: { title: expectedTitle, author: expectedAuthor },
      });
      expect(useLibraryStore.getState().books).toHaveLength(1);
    },
  );

  it("serializes overlapping imports without duplicating the same book", async () => {
    let finishHash!: (value: string) => void;
    mocks.hash.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishHash = resolve;
      }),
    );
    const first = useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "one.epub" }]);
    const second = useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "two.epub" }]);
    await vi.waitFor(() => expect(mocks.hash).toHaveBeenCalledOnce());
    expect(useLibraryStore.getState().isImporting).toBe(true);
    finishHash("new-file");
    const results = await Promise.all([first, second]);
    expect(results.every((result) => result.failures.length === 0)).toBe(true);
    expect(useLibraryStore.getState().books).toHaveLength(1);
    expect(mocks.insertBook).toHaveBeenCalledOnce();
    expect(useLibraryStore.getState().isImporting).toBe(false);
    expect([...mocks.files.keys()]).toEqual([
      "file:///picked.epub",
      "file:///app/books/import-1.epub",
    ]);
  });

  it("does not lose progress advanced while a reimport is saving", async () => {
    useLibraryStore.setState({ books: [existing] });
    mocks.hash.mockResolvedValue("same-file");
    let complete!: () => void;
    mocks.updateBook.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
    await vi.waitFor(() => expect(mocks.updateBook).toHaveBeenCalledOnce());
    const advanced = { ...existing, progress: 0.77, currentCfi: "new-cfi", tags: ["Избранное"] };
    useLibraryStore.setState({ books: [advanced] });
    complete();
    const result = await pending;
    expect(result.imported[0]).toMatchObject({
      progress: 0.77,
      currentCfi: "new-cfi",
      tags: ["Избранное"],
    });
    expect(mocks.updateBook.mock.calls[0][1]).not.toHaveProperty("progress");
    expect(mocks.updateBook.mock.calls[0][1]).not.toHaveProperty("currentCfi");
  });

  it.each([false, true])(
    "does not resurrect a book deleted during reimport save (preserveData: %s)",
    async (preserveData) => {
      useLibraryStore.setState({ books: [structuredClone(existing)] });
      mocks.hash.mockResolvedValue("same-file");
      const rows = new Map<string, Book>([[existing.id, structuredClone(existing)]]);
      let releaseWrite!: () => void;
      const writePending = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      mocks.updateBook.mockImplementation(async (id: string, updates: Partial<Book>) => {
        await writePending;
        // Match the real UPDATE ... WHERE id = ?: a hard-deleted row is not
        // inserted; an explicit deletedAt: undefined clears a soft tombstone.
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, ...updates });
      });
      mocks.deleteBook.mockImplementation(
        async (id: string, options: { preserveData: boolean }) => {
          if (options.preserveData) rows.set(id, { ...rows.get(id)!, deletedAt: 123 });
          else rows.delete(id);
        },
      );
      const pending = useLibraryStore
        .getState()
        .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
      await vi.waitFor(() => expect(mocks.updateBook).toHaveBeenCalledOnce());
      const removal = useLibraryStore.getState().removeBook(existing.id, { preserveData });
      expect(useLibraryStore.getState().books).toEqual([]);
      expect(mocks.deleteBook).not.toHaveBeenCalled();
      releaseWrite();
      const result = await pending;
      await removal;
      expect(mocks.deleteBook).toHaveBeenCalledExactlyOnceWith(existing.id, { preserveData });
      expect.soft(useLibraryStore.getState().books).toEqual([]);
      expect.soft(result.imported).toEqual([]);
      expect.soft(mocks.backend).not.toHaveBeenCalled();
      if (preserveData) expect.soft(rows.get(existing.id)?.deletedAt).toBe(123);
      else expect.soft(rows.has(existing.id)).toBe(false);
      expect([...mocks.files.keys()]).toEqual(["file:///picked.epub"]);
      mocks.updateBook.mockResolvedValue(undefined);
      mocks.getDeletedBookByFileHash.mockResolvedValue(rows.get(existing.id) ?? null);
      const explicitRetry = await useLibraryStore
        .getState()
        .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
      expect(explicitRetry.failures).toEqual([]);
      expect(explicitRetry.imported).toHaveLength(1);
      if (preserveData)
        expect(explicitRetry.imported[0]).toMatchObject({
          id: existing.id,
          progress: existing.progress,
        });
    },
  );

  it("publishes a restored book only after its database update succeeds", async () => {
    const deleted = { ...existing, deletedAt: 20 };
    mocks.getBook.mockResolvedValue(deleted);
    mocks.updateBook.mockRejectedValue(new Error("disk full"));
    mocks.files.set("file:///app/books/existing.epub", bytes("old EPUB"));
    const result = await useLibraryStore
      .getState()
      .reimportDeletedBook(existing.id, { uri: "file:///picked.epub", name: "book.epub" });
    expect(result).toBeNull();
    expect(useLibraryStore.getState().books).toEqual([]);
    expect(mocks.files.get("file:///app/books/existing.epub")).toEqual(bytes("old EPUB"));
    expect(mocks.files.size).toBe(2);
  });

  it("does not resurrect the first batch book deleted during the second file lookup", async () => {
    mocks.hash.mockResolvedValue("same-file");
    let release!: (book: null) => void;
    mocks.getDeletedBookByFileHash.mockResolvedValueOnce(null).mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          release = resolve;
        }),
    );
    const pending = useLibraryStore.getState().importBooks([
      { uri: "file:///picked.epub", name: "book.epub" },
      { uri: "file:///picked.epub", name: "book.epub" },
    ]);
    await vi.waitFor(() => expect(mocks.getDeletedBookByFileHash).toHaveBeenCalledTimes(2));
    const book = useLibraryStore.getState().books[0];
    await useLibraryStore.getState().removeBook(book.id);
    release(null);
    const result = await pending;
    expect(result.failures).toHaveLength(1);
    expect(mocks.updateBook).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().books).toEqual([]);
    expect([...mocks.files.keys()]).toEqual(["file:///picked.epub"]);
  });

  it.each([false, true])(
    "does not revive an explicitly restored book removed during save (%s)",
    async (preserveData) => {
      mocks.getBook.mockResolvedValue({ ...existing, deletedAt: 20 });
      let release!: () => void;
      mocks.updateBook.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const pending = useLibraryStore.getState().reimportDeletedBook(existing.id, {
        uri: "file:///picked.epub",
        name: "book.epub",
      });
      await vi.waitFor(() => expect(mocks.updateBook).toHaveBeenCalledOnce());
      const removal = useLibraryStore.getState().removeBook(existing.id, { preserveData });
      expect(mocks.deleteBook).not.toHaveBeenCalled();
      release();
      expect(await pending).toBeNull();
      await removal;
      expect(mocks.deleteBook).toHaveBeenCalledExactlyOnceWith(existing.id, { preserveData });
      expect(useLibraryStore.getState().books).toEqual([]);
      expect([...mocks.files.keys()]).toEqual(["file:///picked.epub"]);
      expect(useLibraryStore.getState().isImporting).toBe(false);
    },
  );

  it("releases removal coordination after a rejected database deletion", async () => {
    useLibraryStore.setState({ books: [structuredClone(existing)] });
    mocks.deleteBook.mockRejectedValueOnce(new Error("disk failure"));
    await useLibraryStore.getState().removeBook(existing.id);
    mocks.getBook.mockResolvedValue({ ...existing, deletedAt: 20 });
    const restored = await useLibraryStore.getState().reimportDeletedBook(existing.id, {
      uri: "file:///picked.epub",
      name: "book.epub",
    });
    expect(restored?.id).toBe(existing.id);
    await useLibraryStore.getState().removeBook(existing.id);
    expect(mocks.deleteBook).toHaveBeenCalledTimes(2);
    expect(useLibraryStore.getState().isImporting).toBe(false);
  });

  it.each(["import", "restore"])(
    "invalidates a queued %s requested before deletion",
    async (kind) => {
      useLibraryStore.setState({ books: [structuredClone(existing)] });
      mocks.hash.mockResolvedValue("same-file");
      let release!: () => void;
      mocks.updateBook.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const first = useLibraryStore
        .getState()
        .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
      await vi.waitFor(() => expect(mocks.updateBook).toHaveBeenCalledOnce());
      const queued =
        kind === "restore"
          ? useLibraryStore
              .getState()
              .reimportDeletedBook(existing.id, { uri: "file:///picked.epub", name: "book.epub" })
          : useLibraryStore
              .getState()
              .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
      const removal = useLibraryStore.getState().removeBook(existing.id);
      release();
      await first;
      await removal;
      await queued;
      expect(useLibraryStore.getState().books).toEqual([]);
      expect(mocks.insertBook).not.toHaveBeenCalled();
      expect(mocks.updateBook).toHaveBeenCalledOnce();
      expect(useLibraryStore.getState().isImporting).toBe(false);
    },
  );

  it("invalidates queued duplicate intent when a new batch book is subsequently hard-deleted", async () => {
    mocks.hash.mockResolvedValue("same-file");
    let release!: (value: null) => void;
    mocks.getDeletedBookByFileHash.mockResolvedValueOnce(null).mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          release = resolve;
        }),
    );
    // Both requests are issued before the first new book has been published.
    const first = useLibraryStore.getState().importBooks([
      { uri: "file:///picked.epub", name: "book.epub" },
      { uri: "file:///picked.epub", name: "book.epub" },
    ]);
    const queued = useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
    await vi.waitFor(() => expect(mocks.getDeletedBookByFileHash).toHaveBeenCalledTimes(2));
    await useLibraryStore.getState().removeBook(useLibraryStore.getState().books[0].id);
    release(null);
    await first;
    const result = await queued;
    expect(result.imported).toEqual([]);
    expect(useLibraryStore.getState().books).toEqual([]);
    expect(mocks.insertBook).toHaveBeenCalledOnce();
  });

  it("honors a repeated deletion after an explicit restore queued behind pending removal", async () => {
    useLibraryStore.setState({ books: [structuredClone(existing)] });
    mocks.getBook.mockResolvedValue({ ...existing, deletedAt: 20 });
    let release!: () => void;
    mocks.deleteBook.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const firstRemoval = useLibraryStore.getState().removeBook(existing.id, { preserveData: true });
    await vi.waitFor(() => expect(mocks.deleteBook).toHaveBeenCalledOnce());
    const restore = useLibraryStore
      .getState()
      .reimportDeletedBook(existing.id, { uri: "file:///picked.epub", name: "book.epub" });
    const repeatedRemoval = useLibraryStore
      .getState()
      .removeBook(existing.id, { preserveData: true });
    release();
    await firstRemoval;
    await repeatedRemoval;
    expect(await restore).toBeNull();
    expect(mocks.updateBook).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().books).toEqual([]);
  });

  it("does not publish preserved TXT source when saving the book fails", async () => {
    mocks.preserveOriginal.mockResolvedValue({
      path: "narra-backend-sources/import-1.txt",
      format: "txt",
      hash: "new-file",
    });
    mocks.insertBook.mockRejectedValue(new Error("disk full"));
    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.txt" }]);
    expect(result.imported).toEqual([]);
    expect(mocks.setOriginal).not.toHaveBeenCalled();
    expect([...mocks.files.keys()]).toEqual(["file:///picked.epub"]);
  });

  it("uses the converted EPUB when preserving an original TXT fails", async () => {
    mocks.preserveOriginal.mockRejectedValue(new Error("provider unavailable"));
    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.txt" }]);
    expect(result.failures).toEqual([]);
    expect(result.imported[0].format).toBe("epub");
    expect(mocks.backend).toHaveBeenCalledWith(result.imported[0]);
  });

  it("registers converted UMD as EPUB for both the reader and backend", async () => {
    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.umd" }]);
    expect(result.failures).toEqual([]);
    expect(result.imported[0].format).toBe("epub");
    expect(mocks.preserveOriginal).not.toHaveBeenCalled();
    expect(mocks.backend).toHaveBeenCalledWith(expect.objectContaining({ format: "epub" }));
  });

  it.each([0.81, 0.12])(
    "restores exact JSON progress %s after a failed database write and process restart",
    async (progress) => {
      useLibraryStore.setState({ books: [existing] });
      mocks.updateBook.mockRejectedValueOnce(new Error("storage unavailable"));
      const currentCfi = "epubcfi(/6/10!/4/6/2:17)";
      await useLibraryStore.getState().updateBook(existing.id, { progress, currentCfi });
      // Simulate a new JS process: only the serialized cache and older DB row survive.
      useLibraryStore.setState({ books: [], isLoaded: false });
      mocks.getBooks.mockResolvedValue([
        {
          ...existing,
          updatedAt: Date.now() + 100,
          meta: { ...existing.meta, title: "New title" },
        },
      ]);
      await useLibraryStore.getState().loadBooks();
      expect(useLibraryStore.getState().books[0]).toMatchObject({
        progress,
        currentCfi,
        meta: { title: "New title" },
      });
      await vi.waitFor(() => {
        expect(mocks.updateBook).toHaveBeenCalledTimes(2);
        expect(mocks.updateBook).toHaveBeenLastCalledWith(existing.id, { progress, currentCfi });
      });
      expect(JSON.parse(mocks.persisted.get("library-books") ?? "[]")[0]).toMatchObject({
        progress,
        currentCfi,
      });
    },
  );

  it("does not replace progress written while the database snapshot is loading", async () => {
    mocks.persisted.set("library-books", JSON.stringify([existing]));
    mocks.getBooks.mockResolvedValue([existing]);
    let finishTags!: (value: null) => void;
    const load = mocks.load.getMockImplementation();
    if (!load) throw new Error("Missing load implementation");
    mocks.load.mockImplementation((key: string) =>
      key === "library-tags"
        ? new Promise<null>((resolve) => {
            finishTags = resolve;
          })
        : load(key),
    );
    const loading = useLibraryStore.getState().loadBooks();
    await vi.waitFor(() => expect(finishTags).toBeTypeOf("function"));
    await useLibraryStore.getState().updateBook(existing.id, {
      progress: 0.92,
      currentCfi: "exact-live-cfi",
    });
    finishTags(null);
    await loading;
    expect(useLibraryStore.getState().books[0]).toMatchObject({
      progress: 0.92,
      currentCfi: "exact-live-cfi",
    });
  });

  it("restores a page checkpoint after a process exit before the throttled database save", async () => {
    useLibraryStore.setState({ books: [existing], isLoaded: true });
    const position = { progress: 0.72, currentCfi: "epubcfi(/6/8!/4/12)" };
    useLibraryStore.getState().checkpointReadingProgress(existing.id, position);
    // Relocate publishes a local journal without starting a heavyweight DB write.
    expect(mocks.updateBook).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().books[0]).toMatchObject(position);
    const durable = JSON.parse(mocks.persisted.get("library-books") ?? "[]");
    expect(durable[0].localProgressCheckpoint).toMatchObject({ ...position, pending: true });

    // Hard kill has no blur/unmount/AppState callback. Only the journal survives.
    useLibraryStore.setState({ books: [], isLoaded: false });
    mocks.getBooks.mockResolvedValue([{ ...existing }]);
    await useLibraryStore.getState().loadBooks();
    expect(useLibraryStore.getState().books[0]).toMatchObject(position);
  });

  it("ignores invalid or unchanged page checkpoints without journal or database churn", () => {
    useLibraryStore.setState({ books: [existing], isLoaded: true });
    for (const position of [
      { progress: Number.NaN, currentCfi: "broken" },
      { progress: 0.4, currentCfi: "" },
      { progress: 1.1, currentCfi: "broken" },
      { progress: existing.progress, currentCfi: existing.currentCfi ?? "" },
    ])
      useLibraryStore.getState().checkpointReadingProgress(existing.id, position);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.updateBook).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().books[0]).toBe(existing);
  });

  it("does not resurrect deleted books from their pending JSON checkpoints", async () => {
    useLibraryStore.setState({ books: [existing] });
    mocks.updateBook.mockRejectedValueOnce(new Error("storage unavailable"));
    await useLibraryStore
      .getState()
      .updateBook(existing.id, { progress: 0.8, currentCfi: "new-cfi" });
    useLibraryStore.setState({ books: [], isLoaded: false });
    await useLibraryStore.getState().loadBooks();
    expect(useLibraryStore.getState().books).toEqual([]);
    expect(mocks.updateBook).toHaveBeenCalledOnce();
  });

  it("keeps the latest checkpoint when an older database write finishes", async () => {
    useLibraryStore.setState({ books: [existing] });
    let finishFirst!: () => void;
    mocks.updateBook.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const first = useLibraryStore
      .getState()
      .updateBook(existing.id, { progress: 0.7, currentCfi: "first-cfi" });
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    mocks.updateBook.mockRejectedValueOnce(new Error("second write failed"));
    const second = useLibraryStore
      .getState()
      .updateBook(existing.id, { progress: 0.8, currentCfi: "second-cfi" });
    finishFirst();
    await Promise.all([first, second]);
    expect(JSON.parse(mocks.persisted.get("library-books") ?? "[]")[0]).toMatchObject({
      progress: 0.8,
      currentCfi: "second-cfi",
      localProgressCheckpoint: { pending: true, currentCfi: "second-cfi" },
    });
  });

  it("keeps a matching pending checkpoint through reimport", async () => {
    useLibraryStore.setState({ books: [existing] });
    mocks.updateBook.mockRejectedValueOnce(new Error("storage unavailable"));
    await useLibraryStore
      .getState()
      .updateBook(existing.id, { progress: 0.8, currentCfi: "new-cfi" });
    mocks.hash.mockResolvedValue("same-file");
    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///picked.epub", name: "book.epub" }]);
    expect(result.failures).toEqual([]);
    expect(JSON.parse(mocks.persisted.get("library-books") ?? "[]")[0]).toMatchObject({
      localProgressCheckpoint: { pending: true, currentCfi: "new-cfi" },
    });
  });
});
