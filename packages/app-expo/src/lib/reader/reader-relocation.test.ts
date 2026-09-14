import { describe, expect, it } from "vitest";

import { resolveReaderBookLocation, resolveTrackableReaderLocation } from "./reader-relocation";

describe("reader relocation", () => {
  it("uses physical pages and skips byte-based tracking for PDFs", () => {
    const detail = {
      isPDF: true,
      page: { current: 4, total: 127 },
      location: { current: 15, next: 16, total: 500 },
    };

    expect(resolveReaderBookLocation(detail)).toEqual({ current: 3, total: 127 });
    expect(resolveTrackableReaderLocation(detail)).toBeNull();
  });

  it("preserves location reporting for non-PDF fixed-layout books", () => {
    const detail = {
      isPDF: false,
      page: { current: 2, total: 8 },
      location: { current: 15, next: 16, total: 500 },
    };

    expect(resolveReaderBookLocation(detail)).toEqual(detail.location);
    expect(resolveTrackableReaderLocation(detail)).toEqual(detail.location);
  });
});
