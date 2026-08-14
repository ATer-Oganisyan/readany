import { describe, expect, it } from "vitest";
import { isForwardReaderRelocation, readerRelocationMarker } from "./reader-progress";

describe("reader backend progress", () => {
  it("uses the start of the visible renderer page as a conservative section coordinate", () => {
    expect(
      readerRelocationMarker({
        fraction: 0.2,
        section: { current: 3, total: 20 },
        page: { current: 2, total: 4 },
      }),
    ).toMatchObject({ sectionIndex: 3, sectionFraction: 0.25, page: 2 });
  });

  it("treats the first relocation as a baseline and recognizes only forward movement", () => {
    const first = readerRelocationMarker({
      fraction: 0.01,
      section: { current: 0, total: 10 },
      page: { current: 1, total: 2 },
    });
    const next = readerRelocationMarker({
      fraction: 0.02,
      section: { current: 0, total: 10 },
      page: { current: 2, total: 2 },
    });
    expect(isForwardReaderRelocation(null, first)).toBe(false);
    expect(isForwardReaderRelocation(first, next)).toBe(true);
    expect(isForwardReaderRelocation(next, first)).toBe(false);
  });
});
