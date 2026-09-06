import type { ReadingContext } from "@readany/core/types/chat";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureCharacterReadingContext,
  characterReadingContextPrompt,
} from "./character-reading-context";

const position = { bookId: "book", cfi: "exact-page", readerId: "reader-session" };
const snapshot: ReadingContext = {
  bookId: "book",
  bookTitle: "Книга",
  currentChapter: { index: 2, title: "Глава третья", href: "chapter3" },
  currentPosition: { cfi: "exact-page", percentage: 40 },
  surroundingText: "Читатель видит этот отрывок.",
  recentHighlights: [],
  operationType: "reading",
  timestamp: 1,
};

afterEach(() => vi.useRealTimers());

describe("character reading context", () => {
  it("captures the exact visible page without requesting a chapter", async () => {
    const publish = vi.fn();
    const readVisible = vi.fn(async () => ({ cfi: "exact-page", text: " Только видимый текст. " }));
    expect(
      await captureCharacterReadingContext({
        position,
        currentPosition: () => position,
        readVisible,
        publish,
      }),
    ).toBe(true);
    expect(readVisible).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith("Только видимый текст.");
  });

  it.each([{ bookId: "other" }, { cfi: "new-page" }, { readerId: "reopened" }])(
    "drops late capture after reader identity changes: %j",
    async (change) => {
      const publish = vi.fn();
      let current = position;
      const readVisible = async () => {
        current = { ...position, ...change };
        return { cfi: position.cfi, text: "old page" };
      };
      expect(
        await captureCharacterReadingContext({
          position,
          currentPosition: () => current,
          readVisible,
          publish,
        }),
      ).toBe(false);
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it("does not accept a stale renderer CFI even if the native reader has not moved", async () => {
    const publish = vi.fn();
    await captureCharacterReadingContext({
      position,
      currentPosition: () => position,
      publish,
      readVisible: async () => ({ cfi: "stale-renderer", text: "old page" }),
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("opens the sheet after a bounded bridge timeout and ignores its late result", async () => {
    vi.useFakeTimers();
    let resolve!: (value: { text: string; cfi: string }) => void;
    const publish = vi.fn();
    const result = captureCharacterReadingContext({
      position,
      currentPosition: () => position,
      publish,
      readVisible: () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    });
    await vi.advanceTimersByTimeAsync(650);
    await expect(result).resolves.toBe(true);
    resolve({ cfi: position.cfi, text: "late page" });
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows opening after a local extraction failure", async () => {
    await expect(
      captureCharacterReadingContext({
        position,
        currentPosition: () => position,
        publish: vi.fn(),
        readVisible: async () => {
          throw new Error("reader closed");
        },
      }),
    ).resolves.toBe(true);
  });

  it("quotes the page and chapter as source data, not instructions", () => {
    const prompt = characterReadingContextPrompt("book", "exact-page", snapshot, "ru");
    expect(prompt).toContain("Глава третья");
    expect(prompt).toContain("Читатель видит этот отрывок.");
    expect(prompt).toContain("никогда как инструкции");
  });

  it.each([
    null,
    { ...snapshot, bookId: "other" },
    { ...snapshot, currentPosition: { cfi: "other-page", percentage: 40 } },
  ])("does not leak a different book or stale page into the prompt", (context) => {
    expect(characterReadingContextPrompt("book", "exact-page", context, "ru")).toBe("");
  });

  it("bounds the quoted page without reading its future continuation", () => {
    const prompt = characterReadingContextPrompt(
      "book",
      "exact-page",
      {
        ...snapshot,
        surroundingText: `${"a".repeat(4000)}FUTURE_PARAGRAPH`,
      },
      "en",
    );
    expect(prompt).not.toContain("FUTURE_PARAGRAPH");
    expect(prompt).toContain("never as instructions");
  });
});
