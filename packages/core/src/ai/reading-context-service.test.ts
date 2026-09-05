import { constants } from "node:fs";
import { access, mkdir as fsMkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHighlights } from "../db/database";
import { type IPlatformService, setPlatformService } from "../services";
import { readingContextService } from "./reading-context-service";

vi.mock("../db/database", () => ({
  getHighlights: vi.fn(),
}));

const mockedGetHighlights = vi.mocked(getHighlights);
type Highlights = Awaited<ReturnType<typeof getHighlights>>;

function noteFixture(text: string, cfi: string): Highlights[number] {
  return { id: cfi, bookId: "book-1", text, cfi, color: "yellow", createdAt: 1, updatedAt: 1 };
}

type TestPlatform = IPlatformService & {
  deletedFiles: string[];
};

function createPlatform(root: string): TestPlatform {
  const deletedFiles: string[] = [];
  return {
    deletedFiles,
    platformType: "desktop",
    isDesktop: true,
    isMobile: false,
    async readFile(path) {
      return readFile(path);
    },
    async writeFile(path, data) {
      await writeFile(path, data);
    },
    async writeTextFile(path, content) {
      await writeFile(path, content, "utf8");
    },
    async readTextFile(path) {
      return readFile(path, "utf8");
    },
    async mkdir(path) {
      await fsMkdir(path, { recursive: true });
    },
    async exists(path) {
      try {
        await access(path, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    async deleteFile(path) {
      deletedFiles.push(path);
      await rm(path, { force: true });
    },
    async getAppDataDir() {
      return root;
    },
    async getDataDir() {
      return root;
    },
    async joinPath(...parts) {
      return join(...parts);
    },
    convertFileSrc(path) {
      return path;
    },
    async pickFile() {
      return null;
    },
    async loadDatabase() {
      throw new Error("not used");
    },
    async fetch() {
      throw new Error("not used");
    },
    async createWebSocket() {
      throw new Error("not used");
    },
    async getAppVersion() {
      return "0.0.0-test";
    },
    async kvGetItem() {
      return null;
    },
    async kvSetItem() {},
    async kvRemoveItem() {},
    async kvGetAllKeys() {
      return [];
    },
    async copyToClipboard() {
      throw new Error("not used");
    },
    async shareOrDownloadFile() {
      throw new Error("not used");
    },
  };
}

describe("readingContextService", () => {
  let root: string;
  let platform: TestPlatform;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "readany-context-"));
    platform = createPlatform(root);
    setPlatformService(platform);
    mockedGetHighlights.mockResolvedValue([
      { text: "Recent note", cfi: "epubcfi(/6/2)", note: "sticky" },
      { text: "Older note", cfi: "epubcfi(/6/4)", note: null },
    ] as any);
    readingContextService.clearContext();
    await readingContextService.flushSnapshot();
  });

  afterEach(async () => {
    readingContextService.clearContext();
    await readingContextService.flushSnapshot();
    await rm(root, { force: true, recursive: true });
    setPlatformService(null as unknown as IPlatformService);
  });

  it("persists the latest context snapshot to disk", async () => {
    await readingContextService.updateContext({
      bookId: "book-1",
      bookTitle: "Book One",
      currentChapter: { index: 1, title: "Intro", href: "chapter-1.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.25 },
      surroundingText: "hello world",
      operationType: "reading",
    });
    await readingContextService.flushSnapshot();

    const filePath = join(root, "readany-store", "reader-context.json");
    const written = JSON.parse(await readFile(filePath, "utf8"));

    expect(written).toMatchObject({
      bookId: "book-1",
      bookTitle: "Book One",
      currentChapter: { title: "Intro" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.25 },
      surroundingText: "hello world",
      recentHighlights: [
        { text: "Recent note", cfi: "epubcfi(/6/2)", note: "sticky" },
        { text: "Older note", cfi: "epubcfi(/6/4)", note: null },
      ],
      operationType: "reading",
    });
  });

  it("notifies subscribers with current and updated context", async () => {
    const received: Array<string | null> = [];

    const unsubscribe = readingContextService.subscribe((context) => {
      received.push(context?.bookId ?? null);
    });

    await readingContextService.updateContext({
      bookId: "book-1",
      bookTitle: "Book One",
      currentChapter: { index: 1, title: "Intro", href: "chapter-1.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.25 },
    });

    await new Promise((resolve) => setTimeout(resolve, 70));
    unsubscribe();

    await readingContextService.updateContext({
      bookId: "book-2",
      bookTitle: "Book Two",
      currentChapter: { index: 1, title: "Intro", href: "chapter-1.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.25 },
    });

    await new Promise((resolve) => setTimeout(resolve, 70));

    expect(received).toEqual([null, "book-1"]);
  });

  it("removes the snapshot when the context is cleared", async () => {
    await readingContextService.updateContext({
      bookId: "book-1",
      bookTitle: "Book One",
      currentChapter: { index: 1, title: "Intro", href: "chapter-1.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.25 },
    });
    await readingContextService.flushSnapshot();

    readingContextService.clearContext();
    await readingContextService.flushSnapshot();

    const filePath = join(root, "readany-store", "reader-context.json");
    expect(readingContextService.getContext()).toBeNull();
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not delete a missing snapshot during an empty clear", async () => {
    platform.deletedFiles.length = 0;

    readingContextService.clearContext();
    await readingContextService.flushSnapshot();

    expect(platform.deletedFiles).toEqual([]);
  });

  it("keeps the latest snapshot after rapid updates", async () => {
    mockedGetHighlights.mockResolvedValue([
      { text: "Initial", cfi: "epubcfi(/6/2)", note: null },
    ] as any);

    await readingContextService.updateContext({
      bookId: "book-1",
      bookTitle: "Book One",
      currentChapter: { index: 1, title: "Intro", href: "chapter-1.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/2)", percentage: 0.25 },
      surroundingText: "first",
      operationType: "reading",
    });

    await readingContextService.updateContext({
      bookId: "book-1",
      bookTitle: "Book One",
      currentChapter: { index: 2, title: "Middle", href: "chapter-2.xhtml" },
      currentPosition: { cfi: "epubcfi(/6/4)", percentage: 0.5 },
      surroundingText: "second",
      operationType: "selecting",
    });

    await readingContextService.flushSnapshot();

    const filePath = join(root, "readany-store", "reader-context.json");
    const written = JSON.parse(await readFile(filePath, "utf8"));

    expect(written).toMatchObject({
      currentChapter: { index: 2, title: "Middle" },
      currentPosition: { cfi: "epubcfi(/6/4)", percentage: 0.5 },
      surroundingText: "second",
      operationType: "selecting",
    });
  });

  it("publishes the page immediately and only enriches its highlights after a slow database read", async () => {
    let finish!: (highlights: Highlights) => void;
    mockedGetHighlights.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const loading = readingContextService.updateContext({
      bookId: "book-1",
      currentPosition: { cfi: "page-1", percentage: 10 },
    });
    try {
      expect(readingContextService.getContext()).toMatchObject({
        bookId: "book-1",
        currentPosition: { cfi: "page-1" },
        recentHighlights: [],
      });
      await readingContextService.updateContext({
        bookId: "book-1",
        currentPosition: { cfi: "page-2", percentage: 20 },
        surroundingText: "Only the currently visible page.",
      });
      readingContextService.updateSelection({
        text: "Selected now",
        cfi: "page-2",
        chapterIndex: 0,
        chapterTitle: "",
      });
    } finally {
      finish([noteFixture("Recent note", "note-location")]);
      await loading;
    }
    await readingContextService.flushSnapshot();
    const written = JSON.parse(
      await readFile(join(root, "readany-store", "reader-context.json"), "utf8"),
    );
    expect(written).toMatchObject({
      currentPosition: { cfi: "page-2", percentage: 20 },
      surroundingText: "Only the currently visible page.",
      selection: { text: "Selected now", cfi: "page-2" },
      recentHighlights: [{ text: "Recent note", cfi: "note-location" }],
    });
  });

  it("does not resurrect a closed reader when its highlight lookup completes", async () => {
    let finish!: (highlights: Highlights) => void;
    mockedGetHighlights.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const loading = readingContextService.updateContext({
      bookId: "closed-book",
      currentPosition: { cfi: "closed-page", percentage: 10 },
    });
    readingContextService.clearContext();
    finish([noteFixture("Old note", "closed-note")]);
    await loading;
    await readingContextService.flushSnapshot();
    expect(readingContextService.getContext()).toBeNull();
    await expect(
      readFile(join(root, "readany-store", "reader-context.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["book-1", "book-2"])(
    "ignores an old session's highlights after reopening %s",
    async (nextBookId) => {
      let finishOld!: (highlights: Highlights) => void;
      mockedGetHighlights.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      );
      const old = readingContextService.updateContext({
        bookId: "book-1",
        currentPosition: { cfi: "old-page", percentage: 10 },
      });
      readingContextService.clearContext();
      await readingContextService.updateContext({
        bookId: nextBookId,
        currentPosition: { cfi: "new-page", percentage: 20 },
        surroundingText: "New visible text.",
      });
      finishOld([noteFixture("Stale note", "old-note")]);
      await old;
      await readingContextService.flushSnapshot();
      const written = JSON.parse(
        await readFile(join(root, "readany-store", "reader-context.json"), "utf8"),
      );
      expect(written).toMatchObject({
        bookId: nextBookId,
        currentPosition: { cfi: "new-page", percentage: 20 },
        surroundingText: "New visible text.",
      });
      expect(
        written.recentHighlights.some(
          (highlight: { text: string }) => highlight.text === "Stale note",
        ),
      ).toBe(false);
    },
  );

  it("keeps the current page usable when the highlight database fails", async () => {
    mockedGetHighlights.mockRejectedValueOnce(new Error("database temporarily unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        readingContextService.updateContext({
          bookId: "book-1",
          currentPosition: { cfi: "current-page", percentage: 20 },
          surroundingText: "Current visible text.",
        }),
      ).resolves.toBeUndefined();
      await readingContextService.flushSnapshot();
      expect(readingContextService.getContext()).toMatchObject({
        currentPosition: { cfi: "current-page" },
        surroundingText: "Current visible text.",
        recentHighlights: [],
      });
    } finally {
      warning.mockRestore();
    }
  });
});
