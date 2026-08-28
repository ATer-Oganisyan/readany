import { backendCatalogStore } from "@/lib/narra/backend-catalog-store";
import { useEffect, useMemo, useSyncExternalStore } from "react";

/** Focus workers need network ownership without subscribing their parent tree. */
export function useBackendCatalogActivity(active: boolean): void {
  useEffect(() => {
    if (active) return backendCatalogStore.acquire();
  }, [active]);
}

/** Blur releases network ownership without unmounting or clearing the screen. */
export function useBackendCatalog(active = true) {
  const snapshot = useSyncExternalStore(
    backendCatalogStore.subscribe,
    backendCatalogStore.getSnapshot,
    backendCatalogStore.getSnapshot,
  );
  useBackendCatalogActivity(active);
  return useMemo(
    () => ({
      ...snapshot,
      retry: backendCatalogStore.retry,
      refresh: backendCatalogStore.refresh,
    }),
    [snapshot],
  );
}
