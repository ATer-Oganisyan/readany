import {
  emptyNarraBookState,
  withNarraCharacters,
  withNarraChatMessage,
  withNarraMemory,
} from "@/lib/narra/domain";
import type { NarraGenreAnalysis } from "@/lib/narra/genre-analysis";
import {
  CURRENT_PORTRAIT_PROMPT_VERSION,
  migrateGeneratedFemalePortraits,
} from "@/lib/narra/portrait-prompt-migration";
import {
  DEFAULT_SCENE_SUGGESTION_INTERVAL,
  SCENE_SUGGESTION_INTERVALS,
} from "@/lib/narra/scene-suggestion";
import type {
  NarraBackendBinding,
  NarraBookState,
  NarraCharacter,
  NarraChatMessage,
  NarraSceneAudio,
  NarraSceneImage,
  NarraSummary,
} from "@/lib/narra/types";
import { DEFAULT_NARRATOR_PREFERENCE, type NarraNarratorPreference } from "@/lib/narra/voice-rules";
import { create } from "zustand";
import { withPersist } from "./persist";

export interface NarraState {
  books: Record<string, NarraBookState>;
  analyzingBookId: string | null;
  /** Выбор пользователя для голоса нарратора: мужской (Сбер) или женский (Афина). */
  narratorVoicePreference: NarraNarratorPreference;
  /** Частота врезок «нарисовать сцену»: страниц между предложениями, 0 — выкл. */
  sceneSuggestionInterval: number;
  portraitPromptVersion: number;
  _hasHydrated: boolean;
  setNarratorVoicePreference: (preference: NarraNarratorPreference) => void;
  setSceneSuggestionInterval: (interval: number) => void;
  getBookState: (bookId: string) => NarraBookState;
  setAnalyzing: (bookId: string | null) => void;
  setCharacters: (bookId: string, characters: NarraCharacter[], genre?: NarraGenreAnalysis) => void;
  setBackendBinding: (bookId: string, binding: NarraBackendBinding) => void;
  updateCharacter: (bookId: string, characterId: string, updates: Partial<NarraCharacter>) => void;
  setAnalysisError: (bookId: string, error?: string) => void;
  setMemory: (bookId: string, characterId: string, memory: string) => void;
  appendChatMessage: (bookId: string, characterId: string, message: NarraChatMessage) => void;
  setScene: (bookId: string, scene: NarraSceneImage) => void;
  setSceneAudio: (bookId: string, sceneAudio: NarraSceneAudio) => void;
  setSummary: (bookId: string, summary: NarraSummary) => void;
  clearChat: (bookId: string, characterId: string) => void;
  clearBook: (bookId: string) => void;
}

export const useNarraStore = create<NarraState>()(
  withPersist<NarraState>(
    "narra-interactive",
    (set, get) => ({
      books: {},
      analyzingBookId: null,
      narratorVoicePreference: DEFAULT_NARRATOR_PREFERENCE,
      sceneSuggestionInterval: DEFAULT_SCENE_SUGGESTION_INTERVAL,
      portraitPromptVersion: CURRENT_PORTRAIT_PROMPT_VERSION,
      _hasHydrated: false,
      setNarratorVoicePreference: (narratorVoicePreference) => set({ narratorVoicePreference }),
      setSceneSuggestionInterval: (sceneSuggestionInterval) => set({ sceneSuggestionInterval }),
      getBookState: (bookId) => get().books[bookId] ?? emptyNarraBookState(bookId),
      setAnalyzing: (analyzingBookId) => set({ analyzingBookId }),
      setCharacters: (bookId, characters, genre) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyNarraBookState(bookId);
          const analyzedBook = withNarraCharacters(book, characters);
          return {
            books: {
              ...state.books,
              [bookId]: genre ? { ...analyzedBook, genre } : analyzedBook,
            },
          };
        }),
      setBackendBinding: (bookId, backendBinding) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyNarraBookState(bookId);
          return { books: { ...state.books, [bookId]: { ...book, backendBinding } } };
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
      setSceneAudio: (bookId, sceneAudio) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyNarraBookState(bookId);
          return {
            books: {
              ...state.books,
              [bookId]: {
                ...book,
                sceneAudios: {
                  ...(book.sceneAudios ?? {}),
                  [sceneAudio.sourceKey]: sceneAudio,
                },
              },
            },
          };
        }),
      setSummary: (bookId, summary) =>
        set((state) => {
          const book = state.books[bookId] ?? emptyNarraBookState(bookId);
          return {
            books: {
              ...state.books,
              [bookId]: {
                ...book,
                summaries: { ...(book.summaries ?? {}), [summary.sourceKey]: summary },
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
    // Ушедшие варианты частоты врезок (5/15 стр.) приводим к новому дефолту
    (persisted) => {
      const withPortraitsMigrated = migrateGeneratedFemalePortraits(persisted);
      return (SCENE_SUGGESTION_INTERVALS as readonly number[]).includes(
        withPortraitsMigrated.sceneSuggestionInterval,
      )
        ? withPortraitsMigrated
        : {
            ...withPortraitsMigrated,
            sceneSuggestionInterval: DEFAULT_SCENE_SUGGESTION_INTERVAL,
          };
    },
  ),
);
