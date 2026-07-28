import type { NarraBookState, NarraCharacter, NarraChatMessage } from "@/lib/narra/types";
import { create } from "zustand";
import { withPersist } from "./persist";

interface NarraState {
  books: Record<string, NarraBookState>;
  analyzingBookId: string | null;
  _hasHydrated: boolean;
  getBookState: (bookId: string) => NarraBookState;
  setAnalyzing: (bookId: string | null) => void;
  setCharacters: (bookId: string, characters: NarraCharacter[]) => void;
  updateCharacter: (bookId: string, characterId: string, updates: Partial<NarraCharacter>) => void;
  setAnalysisError: (bookId: string, error?: string) => void;
  setMemory: (bookId: string, characterId: string, memory: string) => void;
  setSummary: (bookId: string, chapterKey: string, summary: string) => void;
  appendChatMessage: (bookId: string, characterId: string, message: NarraChatMessage) => void;
  clearChat: (bookId: string, characterId: string) => void;
  clearBook: (bookId: string) => void;
}

const emptyBook = (bookId: string): NarraBookState => ({
  bookId,
  characters: [],
  memories: {},
  summaries: {},
  chats: {},
});

export const useNarraStore = create<NarraState>()(
  withPersist<NarraState>(
    "narra-interactive",
    (set, get) => ({
      books: {},
      analyzingBookId: null,
      _hasHydrated: false,
      getBookState: (bookId) => get().books[bookId] ?? emptyBook(bookId),
      setAnalyzing: (analyzingBookId) => set({ analyzingBookId }),
      setCharacters: (bookId, characters) =>
        set((state) => ({
          books: {
            ...state.books,
            [bookId]: {
              ...(state.books[bookId] ?? emptyBook(bookId)),
              characters,
              analyzedAt: Date.now(),
              analysisError: undefined,
            },
          },
        })),
      updateCharacter: (bookId, characterId, updates) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyBook(bookId);
          return {
            books: {
              ...state.books,
              [bookId]: {
                ...book,
                characters: book.characters.map((character) =>
                  character.id === characterId ? { ...character, ...updates } : character,
                ),
              },
            },
          };
        }),
      setAnalysisError: (bookId, analysisError) =>
        set((state) => ({
          books: {
            ...state.books,
            [bookId]: {
              ...(state.books[bookId] ?? emptyBook(bookId)),
              analysisError,
            },
          },
        })),
      setMemory: (bookId, characterId, memory) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyBook(bookId);
          return {
            books: {
              ...state.books,
              [bookId]: { ...book, memories: { ...book.memories, [characterId]: memory } },
            },
          };
        }),
      setSummary: (bookId, chapterKey, summary) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyBook(bookId);
          return {
            books: {
              ...state.books,
              [bookId]: { ...book, summaries: { ...book.summaries, [chapterKey]: summary } },
            },
          };
        }),
      appendChatMessage: (bookId, characterId, message) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyBook(bookId);
          return {
            books: {
              ...state.books,
              [bookId]: {
                ...book,
                chats: {
                  ...(book.chats ?? {}),
                  [characterId]: [...(book.chats?.[characterId] ?? []), message].slice(-80),
                },
              },
            },
          };
        }),
      clearChat: (bookId, characterId) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyBook(bookId);
          return {
            books: {
              ...state.books,
              [bookId]: { ...book, chats: { ...(book.chats ?? {}), [characterId]: [] } },
            },
          };
        }),
      clearBook: (bookId) =>
        set((state) => {
          const books = { ...state.books };
          delete books[bookId];
          return { books };
        }),
    }),
    { analyzingBookId: null } as Partial<NarraState>,
  ),
);
