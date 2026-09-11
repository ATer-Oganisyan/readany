import { fetchBackendBookToc, parseBackendBookToc } from "@/lib/narra/backend-catalog-api";
import { debouncedSave, loadFromFS } from "@/stores/persist";
import type { Book, TOCItem } from "@readany/core/types";
import { useEffect, useState } from "react";

/** Refresh server TOC on opening; keep the last verified response for offline reading. */
export function useBackendBookToc(book: Book | undefined): TOCItem[] | null {
  const edition =
    book?.sourceKind === "catalog" && book.format === "epub" ? book.bookEditionId : undefined;
  const hash = book?.contentHash;
  const key =
    edition && hash
      ? `reader-toc-${encodeURIComponent(edition)}-${encodeURIComponent(hash)}`
      : null;
  const [result, setResult] = useState<{ key: string; items: TOCItem[] } | null>(null);
  useEffect(() => {
    if (!key || !edition || !hash) return;
    const controller = new AbortController();
    let refreshed = false;
    void loadFromFS<unknown>(key).then((payload) => {
      if (!payload || refreshed || controller.signal.aborted) return;
      try {
        setResult({ key, items: parseBackendBookToc(payload, edition, hash) });
      } catch {
        /* An obsolete or interrupted cache write must not block reading. */
      }
    });
    void fetchBackendBookToc(edition, hash, controller.signal)
      .then(({ payload, items }) => {
        if (controller.signal.aborted) return;
        refreshed = true;
        setResult({ key, items });
        debouncedSave(key, payload);
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.warn("[Reader] Server TOC unavailable:", error);
      });
    return () => controller.abort();
  }, [edition, hash, key]);
  return result?.key === key ? result.items : null;
}
