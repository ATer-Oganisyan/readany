import type { NarraBookState, NarraCharacter, NarraChatMessage } from "./types";

export const MAX_NARRA_CHARACTERS = 8;
export const MAX_NARRA_CHAT_MESSAGES = 80;

export function emptyNarraBookState(bookId: string): NarraBookState {
  return {
    bookId,
    characters: [],
    memories: {},
    chats: {},
    scenes: {},
    sceneAudios: {},
    summaries: {},
  };
}

export function normalizeReadingProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

export function isCharacterUnlocked(
  readingProgress: number,
  characterOrProgress: Pick<NarraCharacter, "unlockProgress"> | number,
): boolean {
  const unlockProgress =
    typeof characterOrProgress === "number"
      ? characterOrProgress
      : characterOrProgress.unlockProgress;
  return normalizeReadingProgress(readingProgress) >= normalizeReadingProgress(unlockProgress);
}

export function withNarraCharacters(
  state: NarraBookState,
  characters: NarraCharacter[],
  analyzedAt = Date.now(),
): NarraBookState {
  return {
    ...state,
    characters: characters.map((character) => {
      const previous = state.characters.find((item) => item.id === character.id);
      return previous?.portraitUri && !character.portraitUri
        ? { ...character, portraitUri: previous.portraitUri }
        : character;
    }),
    analyzedAt,
    analysisError: undefined,
  };
}

export function withNarraMemory(
  state: NarraBookState,
  characterId: string,
  memory: string,
): NarraBookState {
  return { ...state, memories: { ...state.memories, [characterId]: memory } };
}

export function withNarraChatMessage(
  state: NarraBookState,
  characterId: string,
  message: NarraChatMessage,
): NarraBookState {
  return {
    ...state,
    chats: {
      ...state.chats,
      [characterId]: [...(state.chats[characterId] ?? []), message].slice(-MAX_NARRA_CHAT_MESSAGES),
    },
  };
}
