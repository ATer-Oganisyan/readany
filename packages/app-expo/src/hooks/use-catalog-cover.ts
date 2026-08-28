import type { CachedBackendCatalogBook } from "@/lib/narra/backend-catalog-cache";
import { catalogCoverIdentity } from "@/lib/narra/catalog-cover-state";
import { catalogCoverStore } from "@/lib/narra/catalog-cover-store";
import { useCallback, useSyncExternalStore } from "react";

/** Only the card with this cover identity is notified when its download settles. */
export function useCatalogCover(book: CachedBackendCatalogBook): CachedBackendCatalogBook {
  const identity = catalogCoverIdentity(book);
  const subscribe = useCallback(
    (listener: () => void) => catalogCoverStore.subscribe(identity, listener),
    [identity],
  );
  const getSnapshot = useCallback(() => catalogCoverStore.getSnapshot(identity), [identity]);
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return catalogCoverStore.getBook(book);
}
