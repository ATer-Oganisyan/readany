import { describe, expect, it } from "vitest";
import type { BackendCatalogSourceState } from "./backend-catalog-source";
import {
  backendCatalogLoadedFraction,
  backendCatalogReaderProgress,
  estimateBackendCatalogLocations,
  shouldPrefetchBackendCatalogChunk,
} from "./backend-catalog-stream-progress";

function state(overrides: Partial<BackendCatalogSourceState> = {}): BackendCatalogSourceState {
  return {
    contractVersion: "book-content-v1",
    representation: "normalized-text-v1",
    bookEditionId: "edition-1",
    catalogKey: "book-1",
    contentHash: "a".repeat(64),
    textLength: 1_000,
    receivedTextLength: 200,
    byteSize: 1_000,
    receivedBytes: 200,
    nextCursor: "next",
    usedCursors: ["next"],
    ...overrides,
  };
}

describe("backend catalog stream progress", () => {
  it("maps progress in a downloaded prefix to absolute book progress", () => {
    expect(backendCatalogLoadedFraction(state())).toBe(0.2);
    expect(backendCatalogReaderProgress(0.5, state())).toBeCloseTo(0.1);
  });

  it("prefetches near the end of the prefix but stops after the final chunk", () => {
    expect(shouldPrefetchBackendCatalogChunk(0.59, state())).toBe(false);
    expect(shouldPrefetchBackendCatalogChunk(0.6, state())).toBe(true);
    expect(shouldPrefetchBackendCatalogChunk(1, state({ nextCursor: null }))).toBe(false);
  });

  it("estimates the full location count without changing the current location", () => {
    expect(estimateBackendCatalogLocations(12, 40, state())).toEqual({
      current: 12,
      total: 200,
    });
  });
});
