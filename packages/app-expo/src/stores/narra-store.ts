import {
  emptyNarraBookState,
  withNarraCharacters,
  withNarraChatMessage,
  withNarraMemory,
} from "@/lib/narra/domain";
import type {
  NarraBookState,
  NarraCharacter,
  NarraChatMessage,
  NarraSceneImage,
} from "@/lib/narra/types";
import { create } from "zustand";
import { withPersist } from "./persist";

export interface NarraState {
  books: Record<string, NarraBookState>;
  analyzingBookId: string | null;
  _hasHydrated: boolean;
  getBookState: (bookId: string) => NarraBookState;
  setAnalyzing: (bookId: string | null) => void;
  setCharacters: (bookId: string, characters: NarraCharacter[]) => void;
  updateCharacter: (bookId: string, characterId: string, updates: Partial<NarraCharacter>) => void;
  setAnalysisError: (bookId: string, error?: string) => void;
  setMemory: (bookId: string, characterId: string, memory: string) => void;
  appendChatMessage: (bookId: string, characterId: string, message: NarraChatMessage) => void;
  setScene: (bookId: string, scene: NarraSceneImage) => void;
  clearChat: (bookId: string, characterId: string) => void;
  clearBook: (bookId: string) => void;
}

export const useNarraStore = create<NarraState>()(
  withPersist<NarraState>(
    "narra-interactive",
    (set, get) => ({
      books: {},
      analyzingBookId: null,
      _hasHydrated: false,
      getBookState: (bookId) => get().books[bookId] ?? emptyNarraBookState(bookId),
      setAnalyzing: (analyzingBookId) => set({ analyzingBookId }),
      setCharacters: (bookId, characters) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyNarraBookState(bookId);
          return { books: { ...state.books, [bookId]: withNarraCharacters(book, characters) } };
        }),
      updateCharacter: (bookId, characterId, updates) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyNarraBookState(bookId);
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
        set((state) => {
          const book = state.books[bookId] ?? emptyNarraBookState(bookId);
          return { books: { ...state.books, [bookId]: { ...book, analysisError } } };
        }),
      setMemory: (bookId, characterId, memory) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyNarraBookState(bookId);
          return {
            books: { ...state.books, [bookId]: withNarraMemory(book, characterId, memory) },
          };
        }),
      appendChatMessage: (bookId, characterId, message) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyNarraBookState(bookId);
          return {
            books: {
              ...state.books,
              [bookId]: withNarraChatMessage(book, characterId, message),
            },
          };
        }),
      setScene: (bookId, scene) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyNarraBookState(bookId);
          return {
            books: {
              ...state.books,
              [bookId]: {
                ...book,
                scenes: { ...(book.scenes ?? {}), [scene.sourceKey]: scene },
              },
            },
          };
        }),
      clearChat: (bookId, characterId) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyNarraBookState(bookId);
          return {
            books: {
              ...state.books,
              [bookId]: { ...book, chats: { ...book.chats, [characterId]: [] } },
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
    { analyzingBookId: null },
  ),
);
