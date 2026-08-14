import { describe, expect, it } from "vitest";
import { getLibraryScrollBottomPadding } from "./library-scroll-layout";

describe("getLibraryScrollBottomPadding", () => {
  it("keeps the last Android book row above the native tab bar", () => {
    expect(getLibraryScrollBottomPadding("android", 24)).toBe(128);
  });

  it("keeps the last iOS book row above the native tab bar", () => {
    expect(getLibraryScrollBottomPadding("ios", 34)).toBe(107);
  });

  it("uses only the library spacing without a native tab bar", () => {
    expect(getLibraryScrollBottomPadding("web", 0)).toBe(24);
  });
});
