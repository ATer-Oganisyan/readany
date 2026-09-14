import type { RelocateEvent } from "@/hooks/use-reader-bridge";

type ReaderRelocation = Pick<RelocateEvent, "isPDF" | "location" | "page">;

export interface ReaderBookLocation {
  current: number;
  total: number;
}

/**
 * PDFs report physical pages. Other formats keep the location behavior they
 * used before PDF-specific pagination was introduced.
 */
export function resolveReaderBookLocation(detail: ReaderRelocation): ReaderBookLocation | null {
  if (detail.isPDF && detail.page?.total) {
    return { current: detail.page.current - 1, total: detail.page.total };
  }
  return detail.location?.total ? detail.location : null;
}

export function resolveTrackableReaderLocation(
  detail: ReaderRelocation,
): RelocateEvent["location"] | null {
  return detail.isPDF !== true && detail.location?.total ? detail.location : null;
}
