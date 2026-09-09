import { describe, expect, it } from "vitest";
import { previousParagraphIndex } from "./tts-paragraph-navigation";

describe("previous paragraph", () => {
  const ids = ["p1", "p1", "p2", "p2", "p2", "p3"];
  it("skips all sentences of the current paragraph and returns the previous start", () => {
    expect(previousParagraphIndex(ids, 4)).toBe(0);
    expect(previousParagraphIndex(ids, 2)).toBe(0);
    expect(previousParagraphIndex(ids, 5)).toBe(2);
  });
  it("restarts the first available paragraph at the beginning of the queue", () => {
    expect(previousParagraphIndex(ids, 1)).toBe(0);
    expect(previousParagraphIndex(ids, 0)).toBe(0);
  });
  it("does not substitute a sentence jump when paragraph boundaries are missing", () => {
    expect(previousParagraphIndex([], 0)).toBeNull();
    expect(previousParagraphIndex([undefined, "p2"], 1)).toBeNull();
    expect(previousParagraphIndex(ids, 99)).toBeNull();
  });
});
