import type { BackendCatalogSourceState } from "./backend-catalog-source";

export const CATALOG_CHUNK_PREFETCH_FRACTION = 0.6;

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function backendCatalogLoadedFraction(
  state: BackendCatalogSourceState | null | undefined,
): number {
  if (!state) return 1;
  if (state.textLength > 0) {
    return clampFraction(state.receivedTextLength / state.textLength);
  }
  if (state.byteSize <= 0) return 1;
  return clampFraction(state.receivedBytes / state.byteSize);
}

/** Maps Foliate's progress inside the downloaded prefix to progress inside the whole book. */
export function backendCatalogReaderProgress(
  localFraction: number,
  state: BackendCatalogSourceState | null | undefined,
): number {
  return clampFraction(localFraction) * backendCatalogLoadedFraction(state);
}

export function shouldPrefetchBackendCatalogChunk(
  localFraction: number,
  state: BackendCatalogSourceState | null | undefined,
): boolean {
  return Boolean(
    state?.nextCursor && clampFraction(localFraction) >= CATALOG_CHUNK_PREFETCH_FRACTION,
  );
}

export function estimateBackendCatalogLocations(
  current: number,
  loadedTotal: number,
  state: BackendCatalogSourceState | null | undefined,
): { current: number; total: number } {
  const loadedFraction = backendCatalogLoadedFraction(state);
  return {
    current,
    total: Math.max(current, Math.round(loadedTotal / Math.max(loadedFraction, Number.EPSILON))),
  };
}
