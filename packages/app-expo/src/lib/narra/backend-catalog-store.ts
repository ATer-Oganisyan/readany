import { markInteraction } from "@/lib/diagnostics/interaction-performance";
import { fetchBackendCatalogGenres, fetchBackendCatalogPage } from "./backend-catalog-api";
import { backendCatalogStorage } from "./backend-catalog-cache";
import { catalogCoverStore } from "./catalog-cover-store";
import { createCatalogStore } from "./catalog-store";

/** One process-wide metadata owner for Library, Search, and expanded categories. */
export const backendCatalogStore = createCatalogStore({
  storage: backendCatalogStorage,
  fetchPage: (cursor, signal) => {
    markInteraction("catalog.metadata.request");
    return fetchBackendCatalogPage(cursor, undefined, signal);
  },
  fetchGenres: (signal) => {
    markInteraction("catalog.metadata.request");
    return fetchBackendCatalogGenres(signal);
  },
  onCacheError: (error) => console.warn("[Catalog] Metadata cache is unavailable:", error),
});

let retainedBooks = backendCatalogStore.getSnapshot().catalog.books;
backendCatalogStore.subscribe(() => {
  const books = backendCatalogStore.getSnapshot().catalog.books;
  if (books === retainedBooks) return;
  retainedBooks = books;
  catalogCoverStore.retainBooks(books);
});

if (typeof __DEV__ !== "undefined" && __DEV__) {
  Object.assign(globalThis, {
    __NARRA_CATALOG_STATUS__: () => backendCatalogStore.getDiagnostics(),
  });
}
