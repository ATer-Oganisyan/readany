import type { Book } from "@readany/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeBookCharacters } from "./character-analysis";
import { queueBookCharacterAnalysis } from "./character-analysis-queue";
import type { NarraBookState, NarraCharacter } from "./types";

const narraState = vi.hoisted(() => ({
  books: {} as Record<string, NarraBookState>,
  setCharacters: vi.fn(),
}));

vi.mock("@/stores/narra-store", () => ({
  useNarraStore: { getState: () => narraState },
}));
vi.mock("./character-analysis", () => ({
  analyzeBookCharacters: vi.fn(),
}));

const book = {
  id: "book-queue",
  meta: { title: "Новая книга", author: "Автор" },
} as Book;
const characters = [{ id: "hero", name: "Герой" }] as NarraCharacter[];

describe("background character analysis queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    narraState.books = {};
    vi.mocked(analyzeBookCharacters).mockResolvedValue(characters);
  });

  it("deduplicates queued work and marks it as background", async () => {
    const first = queueBookCharacterAnalysis(book, "Фрагмент книги");
    const second = queueBookCharacterAnalysis(book, "Фрагмент книги");

    expect(second).toBe(first);
    await first;
    expect(analyzeBookCharacters).toHaveBeenCalledOnce();
    expect(analyzeBookCharacters).toHaveBeenCalledWith(book, "Фрагмент книги", {
      origin: "background",
    });
  });
});
