import { beforeEach, expect, it, vi } from "vitest";
import type { CatalogStorage } from "./catalog-store";

const runtime = vi.hoisted(() => ({
  page: vi.fn(),
  languagePage: vi.fn(),
  retain: vi.fn(),
  storages: new Map<string, CatalogStorage>(),
}));
vi.mock("@/lib/diagnostics/interaction-performance", () => ({ markInteraction: vi.fn() }));
vi.mock("./backend-catalog-api", () => ({
  fetchBackendCatalogPage: runtime.page,
  fetchBackendLanguageCatalogPage: runtime.languagePage,
  fetchBackendCatalogGenres: async () => ({ version: "v1", items: [] }),
}));
vi.mock("./catalog-cover-store", () => ({ catalogCoverStore: { retainBooks: runtime.retain } }));
vi.mock("./backend-catalog-cache", () => {
  const create = (scope: string) => {
    const storage = {
      read: vi.fn(async () => ({ complete: null, progress: null })),
      begin: vi.fn(async () => {}),
      append: vi.fn(async () => {}),
      commit: vi.fn(async () => {}),
    } satisfies CatalogStorage;
    runtime.storages.set(scope, storage);
    return storage;
  };
  return { backendCatalogStorage: create("all"), createBackendCatalogStorage: create };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  runtime.storages.clear();
});

function item(language: string) {
  return {
    resolution: "catalog",
    bookEditionId: language,
    catalogKey: language,
    title: language,
    author: "Author",
    genres: [],
    format: "epub",
    contentSha256: "a".repeat(64),
    generationStatus: "published",
    ready: true,
    sourceDownloadPath: `/v2/books/${language}/source/download`,
    language,
  };
}

it("routes all/ru/en independently, cancels only the released consumer and resumes its own cursor", async () => {
  runtime.page.mockResolvedValue({ items: [item("other")], nextCursor: null });
  let ruSignal: AbortSignal | undefined;
  let failRu = true;
  runtime.languagePage.mockImplementation(
    async (language: string, cursor: string | undefined, _limit: unknown, signal: AbortSignal) => {
      if (!cursor) return { items: [item(language)], nextCursor: `${language}+/=` };
      if (language === "ru" && failRu) {
        ruSignal = signal;
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
        );
      }
      return { items: [], nextCursor: null };
    },
  );
  const { backendCatalogStore: all, getBackendCatalogStore } = await import(
    "./backend-catalog-store"
  );
  expect(runtime.storages.size).toBe(1); // no hidden language downloads/storage before requested
  const ru = getBackendCatalogStore("ru");
  const en = getBackendCatalogStore("en");
  expect(getBackendCatalogStore("ru")).toBe(ru);
  const releaseAll = all.acquire();
  const releaseRu = ru.acquire();
  const releaseEn = en.acquire();
  try {
    await vi.waitFor(() => expect(en.getSnapshot().hasCompleteCatalog).toBe(true));
    expect(all.getSnapshot().hasCompleteCatalog).toBe(true);
    expect(ruSignal).toBeDefined();
    releaseRu();
    await vi.waitFor(() => expect(ru.getDiagnostics().activeRun).toBe(0));
    expect(ruSignal?.aborted).toBe(true);
    expect(en.getSnapshot().catalog.books[0].language).toBe("en");
    expect(runtime.page).toHaveBeenCalledTimes(1);
    failRu = false;
    const releaseAgain = ru.acquire();
    try {
      await vi.waitFor(() => expect(ru.getSnapshot().hasCompleteCatalog).toBe(true));
      expect(runtime.languagePage.mock.calls.map(([lang, cursor]) => [lang, cursor])).toEqual([
        ["ru", undefined],
        ["en", undefined],
        ["ru", "ru+/="],
        ["en", "en+/="],
        ["ru", "ru+/="],
      ]);
      expect(runtime.storages.get("ru")?.commit).toHaveBeenCalledWith(
        expect.objectContaining({ books: [expect.objectContaining({ language: "ru" })] }),
        expect.any(String),
      );
      expect(
        runtime.retain.mock.lastCall?.[0].map((book: { language: string }) => book.language).sort(),
      ).toEqual(["en", "other", "ru"]);
      const requests = runtime.languagePage.mock.calls.length;
      releaseAgain();
      const releaseFresh = ru.acquire();
      await Promise.resolve();
      expect(runtime.languagePage).toHaveBeenCalledTimes(requests);
      releaseFresh();
    } finally {
      releaseAgain();
    }
  } finally {
    releaseAll();
    releaseRu();
    releaseEn();
  }
});
