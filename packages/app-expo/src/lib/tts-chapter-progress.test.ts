import { describe, expect, it } from "vitest";
import { findNarrationChapter, getTTSCfiStartIdentity } from "./tts-chapter-progress";

describe("chapter location", () => {
  const chapters = [2, 4].map((section) => ({
    id: String(section),
    title: "Chapter",
    segments: [
      { text: "Repeated sentence", cfi: `epubcfi(/6/${section}!/4/2,/1:0,/1:10)` },
      { text: "Repeated sentence", cfi: `epubcfi(/6/${section}!/4/4,/1:0,/1:10)` },
    ],
  }));
  it("uses the document location rather than repeated text or queue position", () => {
    expect(findNarrationChapter(chapters, "epubcfi(/6/4[chapter]!/4/4/1:0)")).toMatchObject({
      chapter: { id: "4" },
      index: 1,
    });
    expect(findNarrationChapter(chapters, "epubcfi(/6/2!/4/2,/1:0,/1:20)")?.index).toBe(0);
    expect(getTTSCfiStartIdentity("epubcfi(/6/2!/4/2,/1:0,/1:10)")).toBe("/6/2!/4/2/1:0");
  });
  it("does not report a false zero for an unknown chapter", () => {
    expect(findNarrationChapter(chapters, "epubcfi(/6/6!/4/2/1:0)")).toBeNull();
    expect(findNarrationChapter(chapters, undefined)).toBeNull();
  });
});
