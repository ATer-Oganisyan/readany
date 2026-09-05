import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import englishCommon from "../../../../core/src/i18n/locales/en/common.json";
import englishLibrary from "../../../../core/src/i18n/locales/en/library.json";
import russianCommon from "../../../../core/src/i18n/locales/ru/common.json";
import russianLibrary from "../../../../core/src/i18n/locales/ru/library.json";

const runtime = vi.hoisted(() => ({
  platform: "android",
  pick: vi.fn(),
  importBooks: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
  parseFicbook: vi.fn(),
  importFicbook: vi.fn(),
  write: vi.fn(),
  prompt: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  alert: vi.fn(),
  complete: vi.fn(),
  open: vi.fn(),
  translate: vi.fn(),
  language: "ru" as "ru" | "en",
}));
vi.mock("@/components/ui/MishanaerIcon", () => ({ MishanaerIcon: "Icon" }));
vi.mock("@/lib/notifications", () => ({
  toast: {
    error: runtime.error,
    success: runtime.success,
    warning: runtime.warning,
    loading: runtime.loading,
    dismiss: runtime.dismiss,
  },
}));
vi.mock("@/stores", () => ({
  useLibraryStore: (select: (state: unknown) => unknown) =>
    select({ importBooks: runtime.importBooks }),
}));
vi.mock("@/styles/ThemeContext", () => ({ useTheme: () => ({ colors: { primary60: "blue" } }) }));
vi.mock("@readany/core/services", () => ({
  getPlatformService: () => ({ downloadFile: runtime.download }),
}));
vi.mock("@readany/core/utils", () => ({ generateId: () => "unique-transfer" }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: runtime.pick }));
vi.mock("expo-file-system", () => ({
  File: class {
    static downloadFileAsync = runtime.download;
    uri: string;
    exists = true;
    constructor(...parts: string[]) {
      this.uri = parts.join("/");
    }
    delete = runtime.remove;
    write = runtime.write;
  },
  Paths: { cache: "file:///cache" },
}));
vi.mock("../../../modules/native-controls", () => ({ default: { promptForText: runtime.prompt } }));
vi.mock("@/lib/book/import-ficbook", () => ({
  parseFicbookUrl: runtime.parseFicbook,
  importFicbookFromUrl: runtime.importFicbook,
}));
vi.mock("react-native", () => ({
  Alert: { alert: runtime.alert },
  Platform: {
    get OS() {
      return runtime.platform;
    },
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: runtime.translate,
  }),
}));

import { useBookImportActions } from "@/hooks/use-book-import-actions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let current: ReturnType<typeof useBookImportActions>;
let tree: ReactTestRenderer;
function Harness() {
  current = useBookImportActions({
    onImportComplete: runtime.complete,
    onOpenImportedBook: runtime.open,
  });
  return null;
}

describe("local import actions", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    runtime.platform = "android";
    runtime.language = "ru";
    runtime.translate.mockImplementation((key: string, options: unknown) => {
      const dictionary: Record<string, string> =
        runtime.language === "ru" ? russianLibrary.library : englishLibrary.library;
      const common: Record<string, string> =
        runtime.language === "ru" ? russianCommon.common : englishCommon.common;
      const value =
        (key.startsWith("common.")
          ? common[key.slice(7)]
          : dictionary[key.replace(/^library\./, "")]) ??
        (typeof options === "string" ? options : key);
      return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String((options as Record<string, unknown>)?.[name] ?? ""),
      );
    });
    runtime.prompt.mockResolvedValue("http://127.0.0.1:8099/book.epub");
    runtime.loading.mockReturnValue("url-loading");
    runtime.parseFicbook.mockReturnValue(null);
    runtime.download.mockImplementation(async (_url: string, file: { uri: string }) => file);
    runtime.importBooks.mockResolvedValue({
      imported: [{ id: "book" }],
      skippedDuplicates: [],
      failures: [],
    });
    runtime.pick.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///book.epub", name: "book.epub" }],
    });
    await act(async () => {
      tree = create(<Harness />);
    });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => tree.unmount());
  });

  it.each(["local", "url"])("offers explicit Open for a single saved %s book", async (source) => {
    const book = { id: "exact-new-book", format: "fbz" };
    runtime.importBooks.mockResolvedValueOnce({
      imported: [book],
      skippedDuplicates: [],
      failures: [],
    });
    await act(async () =>
      source === "local" ? current.handleLocalImport() : current.handleOpenUrlImport(),
    );
    expect(runtime.open).not.toHaveBeenCalled();
    const action = runtime.success.mock.lastCall?.[1].action;
    expect(action).toMatchObject({ label: "Открыть", onClick: expect.any(Function) });
    await act(async () => action.onClick());
    expect(runtime.open).toHaveBeenCalledExactlyOnceWith(book);
  });

  it("ignores a saved toast Open after unmount", async () => {
    await act(async () => current.handleLocalImport());
    const action = runtime.success.mock.lastCall?.[1].action;
    expect(action).toBeDefined();
    await act(async () => tree.unmount());
    await act(async () => action.onClick());
    expect(runtime.open).not.toHaveBeenCalled();
  });

  it("localizes Open in English and keeps each action bound to its saved book", async () => {
    runtime.language = "en";
    const actions = [];
    for (const id of ["first", "second"]) {
      runtime.importBooks.mockResolvedValueOnce({
        imported: [{ id }],
        skippedDuplicates: [],
        failures: [],
      });
      await act(async () => current.handleLocalImport());
      actions.push(runtime.success.mock.lastCall?.[1].action);
    }
    expect(actions[0].label).toBe("Open");
    await act(async () => actions[0].onClick());
    expect(runtime.open).toHaveBeenCalledExactlyOnceWith({ id: "first" });
  });

  it("does not announce or offer navigation for a save completed after unmount", async () => {
    let finish!: (summary: unknown) => void;
    runtime.importBooks.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleLocalImport();
    });
    await act(async () => tree.unmount());
    await act(async () => {
      finish({ imported: [{ id: "late" }], skippedDuplicates: [], failures: [] });
      await pending;
    });
    expect(runtime.success).not.toHaveBeenCalled();
    expect(runtime.complete).not.toHaveBeenCalled();
    expect(runtime.open).not.toHaveBeenCalled();
  });

  it("does not offer Open for a batch or a refreshed duplicate", async () => {
    for (const summary of [
      { imported: [{ id: "a" }, { id: "b" }], skippedDuplicates: [], failures: [] },
      { imported: [{ id: "a" }], refreshedCount: 1, skippedDuplicates: [], failures: [] },
      { imported: [{ id: "a" }], skippedDuplicates: [{ name: "other.epub" }], failures: [] },
    ]) {
      runtime.importBooks.mockResolvedValueOnce(summary);
      await act(async () => current.handleLocalImport());
      expect(runtime.success.mock.lastCall?.[1].action).toBeUndefined();
    }
    expect(runtime.open).not.toHaveBeenCalled();
  });

  it("retains Details instead of Open for partial failure", async () => {
    runtime.importBooks.mockResolvedValueOnce({
      imported: [{ id: "a" }],
      skippedDuplicates: [],
      failures: [{ name: "bad.epub" }],
    });
    await act(async () => current.handleLocalImport());
    expect(runtime.warning.mock.lastCall?.[1].action.label).toBe("Подробнее");
    await act(async () => runtime.warning.mock.lastCall?.[1].action.onClick());
    expect(runtime.alert).toHaveBeenCalledOnce();
    expect(runtime.open).not.toHaveBeenCalled();
  });

  it("lets iOS Files select dynamic book types and still delegates source admission to importBooks", async () => {
    runtime.platform = "ios";
    runtime.pick.mockImplementation(async ({ type }: { type: string[] }) =>
      type.includes("*/*")
        ? { canceled: false, assets: [{ uri: "file:///comic.cbz", name: "comic.cbz" }] }
        : { canceled: true },
    );
    await act(async () => current.handleLocalImport());
    expect(runtime.importBooks).toHaveBeenCalledWith([
      { uri: "file:///comic.cbz", name: "comic.cbz" },
    ]);
  });

  it("shows a save failure and permits a subsequent import", async () => {
    const { BookImportError } = await import("@readany/core/import/import-errors");
    runtime.importBooks.mockRejectedValueOnce(
      new BookImportError("STORAGE_FAILED", "SQLite full /private/app.db"),
    );
    await act(async () => current.handleLocalImport());
    expect(runtime.error).toHaveBeenCalledWith(
      "Не получилось добавить книгу",
      expect.objectContaining({
        description: "Не удалось сохранить книгу. Проверьте свободное место и попробуйте ещё раз.",
      }),
    );
    expect(current.isPickingImport).toBe(false);
    runtime.importBooks.mockResolvedValueOnce({
      imported: [{ id: "book" }],
      skippedDuplicates: [],
      failures: [],
    });
    await act(async () => current.handleLocalImport());
    expect(runtime.success).toHaveBeenCalledOnce();
  });

  it("reports mixed success as a warning with the unchanged imported/duplicate/failure counts", async () => {
    runtime.importBooks.mockResolvedValueOnce({
      imported: Array.from({ length: 12 }, (_, index) => ({ id: String(index) })),
      skippedDuplicates: [{ name: "duplicate.epub" }, { name: "duplicate.txt" }],
      failures: Array.from({ length: 6 }, (_, index) => ({
        name: `bad-${index}.epub`,
        error: "Invalid archive",
      })),
    });
    await act(async () => current.handleLocalImport());
    expect(runtime.warning).toHaveBeenCalledWith(
      "Часть книг добавлена",
      expect.objectContaining({
        description: "Добавлено: 12 · обновлено: 0 · пропущено: 2 · ошибок: 6",
        styles: { description: { display: "flex" } },
        action: expect.objectContaining({ label: "Подробнее", onClick: expect.any(Function) }),
      }),
    );
    expect(runtime.error).not.toHaveBeenCalled();
    expect(runtime.success).not.toHaveBeenCalled();
    expect(runtime.complete).toHaveBeenCalledExactlyOnceWith(12);
  });

  it.each([["cbz"], ["mobi"], ["azw"], ["azw3"], ["epub", "cbz"]])(
    "does not promise characters for an unsupported-only or mixed-format batch: %j",
    async (...formats) => {
      runtime.language = "en";
      runtime.importBooks.mockResolvedValueOnce({
        imported: formats.map((format) => ({ id: format, format })),
        skippedDuplicates: [],
        failures: [],
      });
      await act(async () => current.handleLocalImport());
      expect(runtime.success.mock.calls[0][0]).toBe("Done");
      expect(runtime.success.mock.calls[0][1].icon).toBeUndefined();
    },
  );

  it("announces enrichment when every imported reader format supports character analysis", async () => {
    runtime.language = "en";
    runtime.importBooks.mockResolvedValueOnce({
      imported: ["epub", "fb2", "fbz", "pdf", "txt"].map((format) => ({ id: format, format })),
      skippedDuplicates: [],
      failures: [],
    });
    await act(async () => current.handleLocalImport());
    expect(runtime.success.mock.calls[0][0]).toBe("Done! We'll add the cover and characters soon");
    expect(runtime.success.mock.calls[0][1].icon).toBeDefined();
  });

  it.each(["en", "ru"] as const)(
    "reports update-only import honestly in %s without promising AI",
    async (language) => {
      runtime.language = language;
      runtime.importBooks.mockResolvedValueOnce({
        imported: [{ id: "existing", format: "epub" }],
        refreshedCount: 1,
        skippedDuplicates: [],
        failures: [],
      });
      await act(async () => current.handleLocalImport());
      expect(runtime.success.mock.calls[0][0]).toBe(
        language === "en" ? "Library updated" : "Библиотека обновлена",
      );
      expect(runtime.success.mock.calls[0][1]).toMatchObject({
        description:
          language === "en"
            ? "Added: 0 · updated: 1 · skipped: 0 · failed: 0"
            : "Добавлено: 0 · обновлено: 1 · пропущено: 0 · ошибок: 0",
      });
      expect(runtime.success.mock.calls[0][1].icon).toBeUndefined();
      expect(runtime.complete).toHaveBeenCalledExactlyOnceWith(1);
    },
  );

  it.each(["en", "ru"] as const)(
    "accounts for the native 25-file repeated batch in %s",
    async (language) => {
      runtime.language = language;
      runtime.importBooks.mockResolvedValueOnce({
        imported: Array.from({ length: 17 }, (_, index) => ({ id: String(index), format: "epub" })),
        refreshedCount: 17,
        skippedDuplicates: [],
        failures: Array.from({ length: 8 }, (_, index) => ({
          name: `broken-${index}.epub`,
          code: "CORRUPT_SOURCE",
        })),
      });
      await act(async () => current.handleLocalImport());
      expect(runtime.warning.mock.calls[0][0]).toBe(
        language === "en" ? "Some files could not be added" : "Некоторые файлы не добавлены",
      );
      expect(runtime.warning.mock.calls[0][1].description).toBe(
        language === "en"
          ? "Added: 0 · updated: 17 · skipped: 0 · failed: 8"
          : "Добавлено: 0 · обновлено: 17 · пропущено: 0 · ошибок: 8",
      );
      expect(runtime.warning.mock.calls[0][1].action).toBeDefined();
      expect(runtime.success).not.toHaveBeenCalled();
    },
  );

  it.each(["en", "ru"] as const)(
    "separates added, refreshed, skipped and failed inputs in %s",
    async (language) => {
      runtime.language = language;
      runtime.importBooks.mockResolvedValueOnce({
        imported: [
          { id: "new", format: "epub" },
          { id: "updated", format: "epub" },
        ],
        refreshedCount: 1,
        skippedDuplicates: [{ name: "skipped.epub" }],
        failures: [{ name: "bad.epub", code: "CORRUPT_SOURCE" }],
      });
      await act(async () => current.handleLocalImport());
      expect(runtime.warning.mock.calls[0][0]).toBe(
        language === "en" ? "Some books were added" : "Часть книг добавлена",
      );
      expect(runtime.warning.mock.calls[0][1].description).toBe(
        language === "en"
          ? "Added: 1 · updated: 1 · skipped: 1 · failed: 1"
          : "Добавлено: 1 · обновлено: 1 · пропущено: 1 · ошибок: 1",
      );
    },
  );

  it.each([
    [
      "en",
      "CORRUPT_SOURCE",
      "This book file is damaged or has no readable pages. Choose another copy.",
    ],
    [
      "ru",
      "CORRUPT_SOURCE",
      "Файл книги повреждён или не содержит читаемых страниц. Выберите другую копию.",
    ],
    [
      "en",
      "UNSUPPORTED_FORMAT",
      "This format is not supported. Choose EPUB, PDF, FB2, TXT, or another supported book format.",
    ],
    ["en", "EMPTY_SOURCE", "The file is empty or unavailable. Select it again."],
    ["en", "SOURCE_TOO_LARGE", "The book is too large to import. Choose a smaller copy."],
    [
      "en",
      "STORAGE_FAILED",
      "The book could not be saved. Check free storage space and try again.",
    ],
    ["en", undefined, "This file could not be added. Select it again or choose another copy."],
  ] as const)(
    "shows safe localized details for %s/%s instead of raw parser messages",
    async (language, code, message) => {
      runtime.language = language;
      runtime.importBooks.mockResolvedValueOnce({
        imported: [],
        skippedDuplicates: [],
        failures: [
          {
            name: "bad.umd",
            code,
            error: "UMD: no chapters detected /private/secret <html>service error</html>",
          },
        ],
      });
      await act(async () => current.handleLocalImport());
      await act(async () => runtime.error.mock.calls[0][1].action.onClick());
      expect(runtime.alert.mock.calls[0][1]).toBe(`bad.umd\n${message}`);
    },
  );

  it("reports failed-only import as an error and offers file-specific details", async () => {
    runtime.importBooks.mockResolvedValueOnce({
      imported: [],
      skippedDuplicates: [],
      failures: [{ name: "broken.fb2", code: "CORRUPT_SOURCE", error: "Missing FictionBook root" }],
    });
    await act(async () => current.handleLocalImport());
    expect(runtime.error).toHaveBeenCalledWith(
      "Добавление не удалось",
      expect.objectContaining({
        description: "Добавлено: 0 · обновлено: 0 · пропущено: 0 · ошибок: 1",
      }),
    );
    expect(runtime.warning).not.toHaveBeenCalled();
    const options = runtime.error.mock.calls[0][1];
    await act(async () => options.action.onClick());
    expect(runtime.alert).toHaveBeenCalledWith(
      "Не добавленные файлы",
      "broken.fb2\nФайл книги повреждён или не содержит читаемых страниц. Выберите другую копию.",
      expect.any(Array),
    );
    expect(runtime.complete).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("describes duplicate-only input as already in the library without a failure action", async () => {
    runtime.importBooks.mockResolvedValueOnce({
      imported: [],
      skippedDuplicates: [{ name: "existing.epub" }],
      failures: [],
    });
    await act(async () => current.handleLocalImport());
    expect(runtime.warning).toHaveBeenCalledWith(
      "Уже в библиотеке",
      expect.objectContaining({
        description: "Добавлено: 0 · обновлено: 0 · пропущено: 1 · ошибок: 0",
      }),
    );
    expect(runtime.warning.mock.calls[0][1].action).toBeUndefined();
    expect(runtime.error).not.toHaveBeenCalled();
  });

  it("bounds failure details to ten files and reports the remaining count in English", async () => {
    runtime.language = "en";
    runtime.importBooks.mockResolvedValueOnce({
      imported: [{ id: "saved" }],
      skippedDuplicates: [],
      failures: Array.from({ length: 12 }, (_, index) => ({
        name: `broken-${String(index).padStart(2, "0")}.epub`,
        code: "CORRUPT_SOURCE",
        error: "Invalid archive",
      })),
    });
    await act(async () => current.handleLocalImport());
    expect(runtime.warning).toHaveBeenCalledWith(
      "Some books were added",
      expect.objectContaining({
        description: "Added: 1 · updated: 0 · skipped: 0 · failed: 12",
      }),
    );
    const options = runtime.warning.mock.calls[0][1];
    expect(runtime.alert).not.toHaveBeenCalled();
    await act(async () => options.action.onClick());
    const [title, details] = runtime.alert.mock.calls[0];
    expect(title).toBe("Files that could not be added");
    expect(details.match(/broken-\d\d\.epub/g)).toHaveLength(10);
    expect(details).toContain(
      "broken-09.epub\nThis book file is damaged or has no readable pages. Choose another copy.",
    );
    expect(details).not.toContain("broken-10.epub");
    expect(details).toContain("And 2 more");
  });

  it("does not claim new books were added when only duplicates and failures remain", async () => {
    runtime.importBooks.mockResolvedValueOnce({
      imported: [],
      skippedDuplicates: [{ name: "existing.epub" }],
      failures: [{ name: "bad.epub", error: "Invalid archive" }],
    });
    await act(async () => current.handleLocalImport());
    expect(runtime.warning).toHaveBeenCalledWith(
      "Некоторые файлы не добавлены",
      expect.objectContaining({
        description: "Добавлено: 0 · обновлено: 0 · пропущено: 1 · ошибок: 1",
      }),
    );
    expect(runtime.error).not.toHaveBeenCalled();
  });

  it("bounds individual file names and errors in the native details alert", async () => {
    runtime.importBooks.mockResolvedValueOnce({
      imported: [],
      skippedDuplicates: [],
      failures: [{ name: "name".repeat(1000), error: "message".repeat(1000) }],
    });
    await act(async () => current.handleLocalImport());
    await act(async () => runtime.error.mock.calls[0][1].action.onClick());
    const details: string = runtime.alert.mock.calls[0][1];
    const [name, error] = details.split("\n");
    expect(name).toHaveLength(160);
    expect(error).toBe(
      "Не удалось добавить файл. Выберите его ещё раз или используйте другую копию.",
    );
    expect(name.endsWith("…")).toBe(true);
  });

  it.each([
    ["file:///private/provider/secret/book.epub", "book.epub"],
    ["C:\\private\\book.epub", "book.epub"],
    ["<html>service failure</html>", "File"],
  ])("does not show private paths or markup in a failure name", async (name, displayName) => {
    runtime.language = "en";
    runtime.importBooks.mockResolvedValueOnce({
      imported: [],
      skippedDuplicates: [],
      failures: [{ name, error: "raw /private/secret", code: "NOT_A_KNOWN_CODE" }],
    });
    await act(async () => current.handleLocalImport());
    await act(async () => runtime.error.mock.calls[0][1].action.onClick());
    expect(runtime.alert.mock.calls[0][1]).toBe(
      `${displayName}\nThis file could not be added. Select it again or choose another copy.`,
    );
  });

  it("does not report picker cancellation as an error", async () => {
    runtime.pick.mockResolvedValueOnce({ canceled: true });
    await act(async () => current.handleLocalImport());
    expect(runtime.importBooks).not.toHaveBeenCalled();
    expect(runtime.error).not.toHaveBeenCalled();
    expect(current.isPickingImport).toBe(false);
  });

  it("keeps URL loading and its result below the library header and above native tabs", async () => {
    await act(async () => current.handleOpenUrlImport());
    expect(runtime.loading).toHaveBeenCalledTimes(2);
    for (const [, options] of [...runtime.loading.mock.calls, ...runtime.success.mock.calls]) {
      expect(options).toMatchObject({
        position: "bottom-center",
        styles: { toastContainer: { marginBottom: 80 } },
      });
    }
  });

  it("lets Android users select CBZ books reported as application/x-cbz", async () => {
    runtime.pick.mockImplementationOnce(async ({ type }: { type: string[] }) => ({
      canceled: false,
      assets: type.includes("application/x-cbz")
        ? [{ uri: "file:///comic.cbz", name: "comic.cbz" }]
        : [],
    }));
    await act(async () => current.handleLocalImport());
    expect(runtime.importBooks).toHaveBeenCalledWith([
      { uri: "file:///comic.cbz", name: "comic.cbz" },
    ]);
  });

  it("coalesces two presses while the system picker is open", async () => {
    let finish!: (value: { canceled: boolean }) => void;
    runtime.pick.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleLocalImport();
      await current.handleLocalImport();
    });
    expect(runtime.pick).toHaveBeenCalledOnce();
    await act(async () => {
      finish({ canceled: true });
      await pending;
    });
    expect(current.isPickingImport).toBe(false);
  });

  it("coalesces two URL presses while the prompt or download is pending", async () => {
    let finish!: (value: string) => void;
    runtime.prompt.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleOpenUrlImport();
      void current.handleOpenUrlImport();
    });
    expect(runtime.prompt).toHaveBeenCalledOnce();
    await act(async () => {
      finish("http://127.0.0.1:8099/book.epub");
      await pending;
    });
    expect(runtime.download).toHaveBeenCalledOnce();
    expect(runtime.importBooks).toHaveBeenCalledOnce();
    expect(current.isUrlImporting).toBe(false);
  });

  it("does not turn successful URL import into a failure when cache cleanup fails", async () => {
    runtime.remove.mockImplementation(() => {
      throw new Error("cache permission denied");
    });
    await act(async () => current.handleOpenUrlImport());
    expect(runtime.importBooks).toHaveBeenCalledOnce();
    expect(runtime.success).toHaveBeenCalledOnce();
    expect(runtime.error).not.toHaveBeenCalled();
    expect(current.isUrlImporting).toBe(false);
  });

  it("downloads supported compound FB2 ZIP URLs", async () => {
    runtime.prompt.mockResolvedValue("http://127.0.0.1:8099/book.fb2.zip");
    await act(async () => current.handleOpenUrlImport());
    expect(runtime.importBooks).toHaveBeenCalledWith([
      expect.objectContaining({ name: "book.fb2.zip" }),
    ]);
    expect(runtime.error).not.toHaveBeenCalled();
  });

  it("releases a hung URL download and never imports a late result", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    runtime.download.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleOpenUrlImport();
    });
    expect(current.isUrlImporting).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(135_001);
    });
    expect(current.isUrlImporting).toBe(false);
    expect(runtime.error).toHaveBeenCalledOnce();
    expect(runtime.importBooks).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await pending;
    });
    expect(runtime.importBooks).not.toHaveBeenCalled();
  });

  it("cancels the download transport, ignores late completion, and allows another URL import", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    runtime.download.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleOpenUrlImport();
    });
    const options = runtime.loading.mock.calls[0][1];
    expect(options.action).toMatchObject({ label: "Отмена", onClick: expect.any(Function) });
    const signal: AbortSignal = runtime.download.mock.calls[0][2].signal;
    await act(async () => {
      options.action.onClick();
      await pending;
    });
    expect(signal.aborted).toBe(true);
    expect(current.isUrlImporting).toBe(false);
    expect(runtime.dismiss).toHaveBeenCalledWith("url-loading");
    expect(runtime.error).not.toHaveBeenCalled();
    expect(runtime.importBooks).not.toHaveBeenCalled();
    await act(async () => current.handleOpenUrlImport());
    expect(runtime.importBooks).toHaveBeenCalledOnce();
    await act(async () => {
      finish();
    });
    expect(runtime.importBooks).toHaveBeenCalledOnce();
    expect(runtime.success).toHaveBeenCalledOnce();
  });

  it("cancels Ficbook without writing or importing its late EPUB", async () => {
    vi.useFakeTimers();
    runtime.parseFicbook.mockReturnValue({ workId: "123" });
    let finish!: (result: unknown) => void;
    runtime.importFicbook.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleOpenUrlImport();
    });
    const options = runtime.loading.mock.calls[0][1];
    expect(options.action).toBeDefined();
    const signal: AbortSignal = runtime.importFicbook.mock.calls[0][1].signal;
    await act(async () => {
      options.action.onClick();
      await pending;
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish({ epubBytes: new Uint8Array([1]), fileName: "late.epub" });
    });
    expect(runtime.write).not.toHaveBeenCalled();
    expect(runtime.importBooks).not.toHaveBeenCalled();
    expect(runtime.error).not.toHaveBeenCalled();
    expect(current.isUrlImporting).toBe(false);
  });

  it("keeps a long Ficbook download cancellable beyond the direct-file 135 second deadline", async () => {
    vi.useFakeTimers();
    runtime.parseFicbook.mockReturnValue({ workId: "123" });
    runtime.importFicbook.mockImplementationOnce(() => new Promise(() => {}));
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleOpenUrlImport();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(135_001);
    });
    expect(current.isUrlImporting).toBe(true);
    expect(runtime.error).not.toHaveBeenCalled();
    await act(async () => {
      runtime.loading.mock.calls[0][1].action.onClick();
      await pending;
    });
    expect(current.isUrlImporting).toBe(false);
    expect(runtime.error).not.toHaveBeenCalled();
  });

  it("updates Ficbook chapter progress with Cancel intact and ignores progress after cancellation", async () => {
    runtime.parseFicbook.mockReturnValue({ workId: "123" });
    runtime.importFicbook.mockImplementationOnce(() => new Promise(() => {}));
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleOpenUrlImport();
    });
    const onProgress = runtime.importFicbook.mock.calls[0][1].onProgress;
    expect(onProgress).toBeTypeOf("function");
    await act(async () => {
      onProgress({ completed: 12, total: 100 });
    });
    const update = runtime.loading.mock.lastCall?.[1];
    expect(update).toMatchObject({
      id: "url-loading",
      description: "12/100",
      position: "bottom-center",
      styles: {
        description: { display: "flex" },
        toastContainer: { marginBottom: 80 },
      },
      action: { label: "Отмена", onClick: expect.any(Function) },
    });
    await act(async () => {
      update.action.onClick();
      await pending;
    });
    const count = runtime.loading.mock.calls.length;
    await act(async () => {
      onProgress({ completed: 13, total: 100 });
    });
    expect(runtime.loading).toHaveBeenCalledTimes(count);
    expect(runtime.error).not.toHaveBeenCalled();
    expect(runtime.importBooks).not.toHaveBeenCalled();
  });

  it("removes cancellation before commit and ignores an old cancel action once saving begins", async () => {
    let finish!: (summary: unknown) => void;
    runtime.importBooks.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleOpenUrlImport();
    });
    expect(runtime.importBooks).toHaveBeenCalledOnce();
    const cancel = runtime.loading.mock.calls[0][1].action;
    expect(cancel).toBeDefined();
    expect(runtime.loading.mock.lastCall?.[1]).toMatchObject({
      id: "url-loading",
      action: undefined,
    });
    await act(async () => {
      cancel.onClick();
    });
    expect(runtime.download.mock.calls[0][2].signal.aborted).toBe(false);
    expect(current.isUrlImporting).toBe(true);
    await act(async () => {
      finish({ imported: [{ id: "saved" }], skippedDuplicates: [], failures: [] });
      await pending;
    });
    expect(runtime.success).toHaveBeenCalledOnce();
    expect(runtime.dismiss).not.toHaveBeenCalled();
  });

  it("keeps prompt cancellation separate from an active download", async () => {
    runtime.prompt.mockResolvedValueOnce(null);
    await act(async () => current.handleOpenUrlImport());
    expect(runtime.loading).not.toHaveBeenCalled();
    expect(runtime.download).not.toHaveBeenCalled();
    expect(runtime.error).not.toHaveBeenCalled();
    await act(async () => current.handleOpenUrlImport());
    expect(runtime.importBooks).toHaveBeenCalledOnce();
  });

  it("aborts an active download on unmount without importing its late result", async () => {
    let finish!: () => void;
    runtime.download.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleOpenUrlImport();
    });
    const signal: AbortSignal = runtime.download.mock.calls[0][2].signal;
    await act(async () => {
      tree.unmount();
    });
    await act(async () => {
      await pending;
    });
    expect(signal.aborted).toBe(true);
    expect(runtime.dismiss).toHaveBeenCalledWith("url-loading");
    await act(async () => {
      finish();
    });
    expect(runtime.importBooks).not.toHaveBeenCalled();
    expect(runtime.error).not.toHaveBeenCalled();
  });

  it("does not start downloading a prompt result after the screen unmounts", async () => {
    let finish!: (url: string) => void;
    runtime.prompt.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleOpenUrlImport();
    });
    await act(async () => {
      tree.unmount();
    });
    await act(async () => {
      finish("https://example.test/book.epub");
      await pending;
    });
    expect(runtime.download).not.toHaveBeenCalled();
    expect(runtime.loading).not.toHaveBeenCalled();
  });

  it("removes the cancellation action when the download fails", async () => {
    runtime.download.mockRejectedValueOnce(new Error("connection lost"));
    await act(async () => current.handleOpenUrlImport());
    expect(runtime.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ action: undefined }),
    );
    expect(current.isUrlImporting).toBe(false);
    expect(runtime.dismiss).not.toHaveBeenCalled();
  });
});
