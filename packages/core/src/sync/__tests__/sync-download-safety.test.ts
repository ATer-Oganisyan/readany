import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalBookFilePath, localBookFilePath } from "../local-book-paths";
import type { ISyncBackend } from "../sync-backend";

const runtime = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  row: {
    id: "book-1",
    file_path: "books/book-1.epub",
    title: "Original",
    format: "epub",
    sync_status: "remote",
    current_cfi: "epubcfi(/6/4!/4/2:17)",
  },
  copyFailure: false,
  dbFailure: false,
  validate: vi.fn(),
  update: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../sync-adapter", () => ({
  getSyncAdapter: () => ({
    getAppDataDir: async () => "/app",
    getTempDir: async () => "/temp",
    joinPath: (...parts: string[]) => parts.join("/"),
    ensureDir: async () => {},
    fileExists: async (path: string) => runtime.files.has(path),
    listFiles: async (directory: string) =>
      [...runtime.files.keys()]
        .filter((path) => path.startsWith(`${directory}/`))
        .map((path) => path.slice(directory.length + 1)),
    getFileSize: async (path: string) => runtime.files.get(path)?.length ?? null,
    readFileBytes: async (path: string) => runtime.files.get(path),
    writeFileBytes: async (path: string, bytes: Uint8Array) => {
      runtime.files.set(path, bytes);
    },
    copyFile: runtime.copy,
    deleteFile: runtime.remove,
    validateBookFile: runtime.validate,
    hashFile: async () => "hash",
  }),
}));
vi.mock("../../db/database", () => ({
  getDB: async () => ({ select: async () => [{ ...runtime.row }] }),
  updateBook: runtime.update,
  setBookSyncStatus: async (_id: string, status: string) => {
    runtime.row.sync_status = status;
  },
}));

import { downloadBookFile, syncFiles } from "../sync-files";

const oldBytes = new Uint8Array([1, 2, 3, 4]);
const newBytes = new Uint8Array([5, 6, 7, 8, 9]);
const oldPath = "/app/books/book-1.epub";
function backend(bytes = newBytes, direct = true): ISyncBackend {
  return {
    type: "webdav",
    ...(direct
      ? {
          getFileToPath: vi.fn(async (_remote: string, target: string) => {
            runtime.files.set(target, bytes);
          }),
        }
      : {}),
    get: vi.fn(async () => bytes),
    listDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    putFile: vi.fn(async () => {}),
    getJSON: vi.fn(async () => null),
    putJSON: vi.fn(async () => {}),
  } as unknown as ISyncBackend;
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.files.clear();
  runtime.files.set(oldPath, oldBytes);
  runtime.row = {
    id: "book-1",
    file_path: "books/book-1.epub",
    title: "Original",
    format: "epub",
    sync_status: "remote",
    current_cfi: "epubcfi(/6/4!/4/2:17)",
  };
  runtime.copyFailure = false;
  runtime.dbFailure = false;
  runtime.validate.mockReset().mockResolvedValue(undefined);
  runtime.copy.mockImplementation(async (source: string, target: string) => {
    const bytes = runtime.files.get(source);
    if (!bytes) throw new Error("Copy source missing");
    runtime.files.set(target, runtime.copyFailure ? bytes.slice(0, 1) : bytes.slice());
    if (runtime.copyFailure) throw new Error("disk full after a partial copy");
  });
  runtime.remove.mockImplementation(async (path: string) => {
    runtime.files.delete(path);
  });
  runtime.update.mockImplementation(
    async (_id: string, updates: { filePath?: string; syncStatus?: string }) => {
      if (runtime.dbFailure) throw new Error("database unavailable");
      if (updates.filePath) runtime.row.file_path = updates.filePath;
      if (updates.syncStatus) runtime.row.sync_status = updates.syncStatus;
    },
  );
});

describe("copy-on-write cloud book downloads", () => {
  it.each(["local", "remote"])(
    "does not adopt another UUID's same-title edition when the requested %s source is unavailable",
    async (status) => {
      runtime.row.sync_status = status;
      const before = { ...runtime.row };
      const otherBookId = "22222222-2222-4222-8222-222222222222";
      const folder = `Original-${otherBookId}`;
      const source = backend();
      if (source.getFileToPath)
        vi.mocked(source.getFileToPath).mockImplementation(async (remote, target) => {
          if (!remote.includes(otherBookId)) throw new Error("404 not found");
          // Different edition, same display title; old locators do not belong to it.
          runtime.files.set(target, newBytes);
        });
      vi.mocked(source.listDir).mockResolvedValue([
        {
          name: folder,
          path: `/readany/data/books/${folder}`,
          isDirectory: true,
          size: 0,
          lastModified: 0,
        },
      ]);
      expect(await downloadBookFile(source, "book-1", runtime.row.file_path)).toBe("not-found");
      expect(runtime.row).toEqual(before);
      expect(runtime.files.get(oldPath)).toEqual(oldBytes);
      expect([...runtime.files.keys()]).toEqual([oldPath]);
      expect(source.getFileToPath).not.toHaveBeenCalledWith(
        expect.stringContaining(otherBookId),
        expect.anything(),
        expect.anything(),
      );
      expect(runtime.update).not.toHaveBeenCalled();
    },
  );

  it.each(["empty", "partial-copy", "invalid-container", "database", "not-found"])(
    "keeps an already readable local book available after %s refresh failure",
    async (failure) => {
      runtime.row.sync_status = "local";
      runtime.copyFailure = failure === "partial-copy";
      runtime.dbFailure = failure === "database";
      if (failure === "invalid-container")
        runtime.validate.mockRejectedValue(new Error("corrupt container"));
      const source = backend(failure === "empty" ? new Uint8Array() : newBytes);
      if (failure === "not-found" && source.getFileToPath)
        vi.mocked(source.getFileToPath).mockRejectedValue(new Error("404 not found"));
      expect(await downloadBookFile(source, "book-1", runtime.row.file_path)).toBe(
        failure === "not-found" ? "not-found" : "error",
      );
      expect(runtime.row).toMatchObject({ file_path: "books/book-1.epub", sync_status: "local" });
      expect(runtime.files.get(oldPath)).toEqual(oldBytes);
    },
  );

  it("makes a missing formerly local source retryable when the remote also fails", async () => {
    runtime.row.sync_status = "local";
    runtime.files.delete(oldPath);
    const source = backend(new Uint8Array());
    expect(await downloadBookFile(source, "book-1", runtime.row.file_path)).toBe("error");
    expect(runtime.row.sync_status).toBe("remote");
  });

  it.each(["empty", "partial-copy", "invalid-container", "database"])(
    "keeps old bytes and DB pointer on %s failure, deleting only new artifacts",
    async (failure) => {
      runtime.copyFailure = failure === "partial-copy";
      runtime.dbFailure = failure === "database";
      if (failure === "invalid-container")
        runtime.validate.mockRejectedValue(new Error("corrupt container"));
      const source = backend(failure === "empty" ? new Uint8Array() : newBytes);
      expect(await downloadBookFile(source, "book-1", runtime.row.file_path)).toBe("error");
      expect(runtime.row.file_path).toBe("books/book-1.epub");
      expect(runtime.files.get(oldPath)).toEqual(oldBytes);
      expect([...runtime.files.keys()]).toEqual([oldPath]);
      expect(runtime.remove).not.toHaveBeenCalledWith(oldPath);
    },
  );

  it.each([true, false])(
    "publishes a fully readable new artifact after a successful direct=%s transfer",
    async (direct) => {
      const source = backend(newBytes, direct);
      expect(await downloadBookFile(source, "book-1", runtime.row.file_path)).toBe("ok");
      expect(runtime.row.file_path).toMatch(/^books\/book-1-download-.*\.epub$/);
      expect(runtime.files.get(`/app/${runtime.row.file_path}`)).toEqual(newBytes);
      expect(runtime.files.get(oldPath)).toEqual(oldBytes);
      expect(runtime.validate).toHaveBeenCalledExactlyOnceWith(
        `/app/${runtime.row.file_path}`,
        "epub",
      );
      expect(runtime.row.sync_status).toBe("local");
      expect([...runtime.files.keys()].some((path) => path.startsWith("/temp/"))).toBe(false);
    },
  );

  it("uploads the current artifact on the next sync instead of the stale canonical file", async () => {
    const source = backend();
    expect(await downloadBookFile(source, "book-1", runtime.row.file_path)).toBe("ok");
    const currentPath = `/app/${runtime.row.file_path}`;
    const target = backend();
    const result = await syncFiles(target, undefined, {
      forceUploadAll: true,
      disableRemoteDeletes: true,
    });
    expect(result.filesUploaded).toBe(1);
    expect(target.putFile).toHaveBeenCalledWith(
      expect.any(String),
      currentPath,
      expect.any(Function),
    );
    expect(target.putFile).not.toHaveBeenCalledWith(
      expect.any(String),
      oldPath,
      expect.any(Function),
    );
    expect(runtime.files.get(currentPath)).toEqual(newBytes);
    expect(runtime.files.get(oldPath)).toEqual(oldBytes);
  });

  it.each([false, true])(
    "batch sync also publishes by pointer only after DB success; failure=%s",
    async (failure) => {
      runtime.dbFailure = failure;
      const source = backend();
      vi.mocked(source.listDir).mockImplementation(async (path) =>
        path.endsWith("/books")
          ? [
              {
                name: "Original-book-1",
                path: `${path}/Original-book-1`,
                isDirectory: true,
                size: 0,
                lastModified: 0,
              },
            ]
          : [
              {
                name: "Original.epub",
                path: `${path}/Original.epub`,
                isDirectory: false,
                size: newBytes.length,
                lastModified: 0,
              },
            ],
      );
      const result = await syncFiles(source, undefined, {
        forceDownloadAll: true,
        disableUploads: true,
        disableRemoteDeletes: true,
      });
      expect(result.filesDownloaded).toBe(failure ? 0 : 1);
      expect(result.filesDownloadFailed).toBe(failure ? 1 : 0);
      expect(runtime.files.get(oldPath)).toEqual(oldBytes);
      if (failure) {
        expect(runtime.row.file_path).toBe("books/book-1.epub");
        expect([...runtime.files.keys()]).toEqual([oldPath]);
      } else {
        expect(runtime.row.file_path).not.toBe("books/book-1.epub");
        expect(runtime.files.get(`/app/${runtime.row.file_path}`)).toEqual(newBytes);
      }
    },
  );

  it("rejects an unsafe book identity before any write or download", async () => {
    const source = backend();
    expect(await downloadBookFile(source, "../../victim", "books/book.epub")).toBe("error");
    expect(source.getFileToPath).not.toHaveBeenCalled();
    expect(runtime.update).not.toHaveBeenCalled();
    expect([...runtime.files.keys()]).toEqual([oldPath]);
  });

  it("uses the stored FBZ format when its managed source has a .zip extension", async () => {
    runtime.row.format = "fbz";
    runtime.row.file_path = "books/book-1.zip";
    expect(await downloadBookFile(backend(), "book-1", runtime.row.file_path)).toBe("ok");
    expect(runtime.validate).toHaveBeenCalledWith(expect.stringMatching(/\.zip$/), "fbz");
  });
});

describe("managed local book paths", () => {
  it("keeps an existing managed relative artifact", () => {
    expect(localBookFilePath("book-1", "books/book-1-download-copy.epub")).toBe(
      "books/book-1-download-copy.epub",
    );
  });
  it.each([
    "../outside.epub",
    "books/../outside.epub",
    "books/%2e%2e%2foutside.epub",
    "books/sub/book.epub",
    "file:///other-device/books/book.epub",
    "/private/other/book.epub",
    "C:\\other\\book.epub",
  ])("does not reuse an unsafe or foreign path: %s", (path) => {
    expect(localBookFilePath("book-1", path)).toBe("books/book-1.epub");
  });
  it("rejects traversal in a remote record id as well", () => {
    expect(canonicalBookFilePath("../../outside", "book.epub")).toBe("");
  });
});
