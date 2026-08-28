import { markInteraction } from "@/lib/diagnostics/interaction-performance";
import {
  fetchBackendCatalogGenres,
  fetchBackendCatalogPage,
  fetchBackendLanguageCatalogPage,
} from "./backend-catalog-api";
import { backendCatalogStorage, createBackendCatalogStorage } from "./backend-catalog-cache";
import { type CatalogLanguage, isCatalogLanguage } from "./book-language";
import { catalogCoverStore } from "./catalog-cover-store";
import { type CatalogStore, createCatalogStore } from "./catalog-store";

// Separate loaders AND disk journals: opaque cursors never cross endpoint/language boundaries.
const stores = new Map<CatalogLanguage | "all", CatalogStore>();

export function getBackendCatalogStore(language?: CatalogLanguage): CatalogStore {
  if (language !== undefined && !isCatalogLanguage(language))
    throw new Error("Invalid catalog language");
  const key = language ?? "all";
  const existing = stores.get(key);
  if (existing) return existing;
  const store = createCatalogStore({
    storage: language ? createBackendCatalogStorage(language) : backendCatalogStorage,
    fetchPage: (cursor, signal) => {
      markInteraction("catalog.metadata.request");
      return language
        ? fetchBackendLanguageCatalogPage(language, cursor, undefined, signal)
        : fetchBackendCatalogPage(cursor, undefined, signal);
    },
    fetchGenres: (signal) => {
      markInteraction("catalog.metadata.request");
      return fetchBackendCatalogGenres(signal);
    },
    onCacheError: (error) => console.warn("[Catalog] Metadata cache is unavailable:", error),
  });
  stores.set(key, store);
  let retainedBooks = store.getSnapshot().catalog.books;
  store.subscribe(() => {
    const books = store.getSnapshot().catalog.books;
    if (books === retainedBooks) return;
    retainedBooks = books;
    // A language refresh must not evict covers still used by another catalog.
    catalogCoverStore.retainBooks(
      Array.from(stores.values()).flatMap((value) => value.getSnapshot().catalog.books),
    );
  });
  return store;
}

/** Existing screens keep the complete, unfiltered catalog. Language stores are lazy. */
export const backendCatalogStore = getBackendCatalogStore();

if (typeof __DEV__ !== "undefined" && __DEV__) {
  Object.assign(globalThis, {
    __NARRA_CATALOG_STATUS__: () => backendCatalogStore.getDiagnostics(),
  });
}
