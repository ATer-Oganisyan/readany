import {
  type BackendBookBinding,
  type BackendBookManifest,
  backendConfirmedCharacters,
} from "@/lib/narra/backend-book-contract";
import {
  emptyNarraBookState,
  withNarraCharacterUpdates,
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
  setBackendOriginalSource: (
    bookId: string,
    source: NonNullable<NarraBookState["backendOriginalSource"]>,
  ) => void;
  setBackendBinding: (bookId: string, binding: BackendBookBinding) => void;
  applyBackendManifest: (bookId: string, manifest: BackendBookManifest, progress: number) => void;
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
      setBackendOriginalSource: (bookId, backendOriginalSource) =>
        set((state) => ({
          books: {
            ...state.books,
            [bookId]: {
              ...(state.books[bookId] ?? emptyNarraBookState(bookId)),
              backendOriginalSource,
            },
          },
        })),
      setBackendBinding: (bookId, backendBinding) => {
        const state = get();
        const book = state.books[bookId] ?? emptyNarraBookState(bookId);
        if (JSON.stringify(book.backendBinding) === JSON.stringify(backendBinding)) return;
        set({ books: { ...state.books, [bookId]: { ...book, backendBinding } } });
      },
      applyBackendManifest: (bookId, manifest, progress) => {
        if (manifest.availability !== "ready") return;
        const state = get();
        const book = state.books[bookId] ?? emptyNarraBookState(bookId);
        if (
          book.backendManifest?.revision !== undefined &&
          manifest.revision !== undefined &&
          manifest.revision < book.backendManifest.revision
        )
          return;
        const characters = backendConfirmedCharacters(manifest, progress).map((character) => {
          const previous = book.characters.find(
            (item) => item.id === character.id && item.backendManaged,
          );
          if (!previous) return character;
          const backendMedia = Object.fromEntries(
            Object.entries(previous.backendMedia ?? {}).filter(([type, media]) =>
              character.backendAssets?.some(
                (asset) => asset.type === type && asset.contentHash === media?.hash,
              ),
            ),
          );
          return {
            ...character,
            backendMedia,
            portraitUri: previous.portraitUriOverridesAsset
              ? previous.portraitUri
              : backendMedia.primary_portrait?.uri,
            portraitUriOverridesAsset: previous.portraitUriOverridesAsset,
            voiceOverride: previous.voiceOverride,
          };
        });
        const next = withNarraCharacters(book, characters, book.analyzedAt ?? Date.now());
        if (
          next.characters === book.characters &&
          JSON.stringify(book.backendManifest) === JSON.stringify(manifest)
        )
          return;
        set({ books: { ...state.books, [bookId]: { ...next, backendManifest: manifest } } });
      },
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
      updateCharacter: (bookId, characterId, updates) => {
        const state = get();
        const book = state.books[bookId];
        if (!book) return;
        const updated = withNarraCharacterUpdates(book, characterId, updates);
        // Avoid even calling persisted set for a no-op: its wrapper would
        // otherwise schedule serialization of the entire Narra state.
        if (updated === book) return;
        set({ books: { ...state.books, [bookId]: updated } });
      },
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
