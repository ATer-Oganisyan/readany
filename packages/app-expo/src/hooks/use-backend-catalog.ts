import { getBackendCatalogStore } from "@/lib/narra/backend-catalog-store";
import type { CatalogLanguage } from "@/lib/narra/book-language";
import { useEffect, useMemo, useSyncExternalStore } from "react";

/** Focus workers need network ownership without subscribing their parent tree. */
export function useBackendCatalogActivity(active: boolean, language?: CatalogLanguage): void {
  const store = getBackendCatalogStore(language);
  useEffect(() => {
    if (active) return store.acquire();
  }, [active, store]);
}

/** Blur releases network ownership without unmounting or clearing the screen. */
export function useBackendCatalog(active = true, language?: CatalogLanguage) {
  const store = getBackendCatalogStore(language);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useBackendCatalogActivity(active, language);
  return useMemo(
    () => ({
      ...snapshot,
      retry: store.retry,
      refresh: store.refresh,
    }),
    [snapshot, store],
  );
}
