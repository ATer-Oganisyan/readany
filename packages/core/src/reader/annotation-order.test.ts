import { describe, expect, it } from "vitest";
import { compareCfiPosition, isCfiOnPage, sortAnnotationsByPosition } from "./annotation-order";

describe("annotation-order", () => {
  it("sorts EPUB CFIs by numeric book position", () => {
    const sorted = sortAnnotationsByPosition([
      { id: "third", cfi: "epubcfi(/6/10!/4/2)", createdAt: 1 },
      { id: "first", cfi: "epubcfi(/6/2!/4/2)", createdAt: 3 },
      { id: "second", cfi: "epubcfi(/6/4!/4/2)", createdAt: 2 },
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["first", "second", "third"]);
  });

  it("sorts page CFIs numerically", () => {
    expect(compareCfiPosition("page:2", "page:10")).toBeLessThan(0);
  });

  it("uses created time as a stable tie-breaker for the same position", () => {
    const sorted = sortAnnotationsByPosition([
      { id: "newer", cfi: "epubcfi(/6/2!/4/2)", createdAt: 200 },
      { id: "older", cfi: "epubcfi(/6/2!/4/2)", createdAt: 100 },
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["older", "newer"]);
  });

  it("places annotations without a usable position after positioned annotations", () => {
    const sorted = sortAnnotationsByPosition([
      { id: "missing", createdAt: 1 },
      { id: "blank", cfi: " ", createdAt: 2 },
      { id: "positioned", cfi: "epubcfi(/6/2!/4/2)", createdAt: 3 },
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["positioned", "missing", "blank"]);
  });

  describe("isCfiOnPage", () => {
    const page = "epubcfi(/6/6!/4/2,/116/1:145,/126/1:72)";

    it("matches a bookmark whose page started inside the visible page", () => {
      // Saved before a layout change: its page began at /118, which now falls on this page.
      expect(isCfiOnPage("epubcfi(/6/6!/4/2,/118,/124/1:66)", page)).toBe(true);
    });

    it("matches the exact same page range", () => {
      expect(isCfiOnPage(page, page)).toBe(true);
    });

    it("ignores bookmarks that start before or after the visible page", () => {
      expect(isCfiOnPage("epubcfi(/6/6!/4/2,/106/1:761,/108/1:817)", page)).toBe(false);
      expect(isCfiOnPage("epubcfi(/6/6!/4/2,/126/1:72,/140)", page)).toBe(false);
      expect(isCfiOnPage("epubcfi(/6/8!/4/2,/2,/10)", page)).toBe(false);
    });

    it("compares page CFIs exactly", () => {
      expect(isCfiOnPage("page:3", "page:3")).toBe(true);
      expect(isCfiOnPage("page:3", "page:4")).toBe(false);
    });
  });
});
