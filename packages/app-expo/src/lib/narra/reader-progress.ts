export interface ReaderRelocationMarker {
  fraction?: number;
  sectionIndex?: number;
  sectionFraction?: number;
  page?: number;
  location?: number;
}

interface RelocationLike {
  fraction?: number;
  section?: { current: number; total: number };
  page?: { current: number; total: number };
  location?: { current: number; next: number; total: number };
}

export function readerRelocationMarker(detail: RelocationLike): ReaderRelocationMarker {
  const pageCurrent = detail.page?.current;
  const pageTotal = detail.page?.total;
  const sectionFraction =
    Number.isFinite(pageCurrent) && Number.isFinite(pageTotal) && Number(pageTotal) > 0
      ? Math.min(1, Math.max(0, (Number(pageCurrent) - 1) / Number(pageTotal)))
      : 0;
  return {
    fraction: detail.fraction,
    sectionIndex: detail.section?.current,
    sectionFraction,
    page: detail.page?.current,
    location: detail.location?.current,
  };
}

/** Initial/restoration relocations establish a baseline; only real forward movement is synced. */
export function isForwardReaderRelocation(
  previous: ReaderRelocationMarker | null,
  current: ReaderRelocationMarker,
): boolean {
  if (!previous) return false;
  if (current.sectionIndex != null && previous.sectionIndex != null) {
    if (current.sectionIndex !== previous.sectionIndex) {
      return current.sectionIndex > previous.sectionIndex;
    }
    if (current.page != null && previous.page != null && current.page !== previous.page) {
      return current.page > previous.page;
    }
  }
  if (
    current.location != null &&
    previous.location != null &&
    current.location !== previous.location
  ) {
    return current.location > previous.location;
  }
  if (current.fraction != null && previous.fraction != null) {
    return current.fraction > previous.fraction + Number.EPSILON;
  }
  return false;
}
