import type { CachedBackendCatalogBook } from "@/lib/narra/backend-catalog-cache";
import { catalogCoverCoordinator } from "@/lib/narra/catalog-cover-coordinator";
import { catalogCoverStore, getCatalogBookWithCover } from "@/lib/narra/catalog-cover-store";
import { useEffect, useRef } from "react";

export function useCatalogCoverWindow({
  visible,
  nearby,
  active,
}: {
  visible: CachedBackendCatalogBook[];
  nearby: CachedBackendCatalogBook[];
  active: boolean;
}): void {
  const owner = useRef(Symbol("catalog-cover-window")).current;
  const wasActive = useRef(false);
  useEffect(() => {
    if (active) {
      if (!wasActive.current) {
        for (const book of [...visible, ...nearby]) {
          if (getCatalogBookWithCover(book).coverLoadFailed) catalogCoverStore.retry(book);
        }
      }
      catalogCoverCoordinator.setWindow(owner, { visible, nearby });
    } else {
      catalogCoverCoordinator.removeWindow(owner);
    }
    wasActive.current = active;
  }, [active, nearby, owner, visible]);
  useEffect(
    () => () => {
      wasActive.current = false;
      catalogCoverCoordinator.removeWindow(owner);
    },
    [owner],
  );
}
