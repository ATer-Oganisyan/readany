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
      if (!previous) return character;
      const merged = { ...character };
      // Портрет и ручной выбор голоса переживают повторный анализ книги.
      if (previous.portraitUri && !character.portraitUri) {
        merged.portraitUri = previous.portraitUri;
        merged.portraitUriOverridesAsset = previous.portraitUriOverridesAsset;
      }
      if (previous.portraitAssetId && !character.portraitAssetId) {
        merged.portraitAssetId = previous.portraitAssetId;
      }
      if (previous.voiceOverride && !character.voiceOverride) {
        merged.voiceOverride = previous.voiceOverride;
      }
      // Ударение имени (P9) не теряется, если новый анализ его не вернул.
      if (previous.stressedName && !character.stressedName) {
        merged.stressedName = previous.stressedName;
      }
      return merged;
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
