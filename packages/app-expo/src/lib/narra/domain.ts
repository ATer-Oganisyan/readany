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

export function withNarraCharacterUpdates(
  state: NarraBookState,
  characterId: string,
  updates: Partial<NarraCharacter>,
): NarraBookState {
  const index = state.characters.findIndex((character) => character.id === characterId);
  if (index < 0) return state;
  const current = state.characters[index];
  const keys = Object.keys(updates) as (keyof NarraCharacter)[];
  if (keys.every((key) => Object.is(current[key], updates[key]))) return state;

  const characters = [...state.characters];
  characters[index] = { ...current, ...updates };
  return { ...state, characters };
}

export function withNarraCharacters(
  state: NarraBookState,
  characters: NarraCharacter[],
  analyzedAt = Date.now(),
): NarraBookState {
  const nextCharacters = characters.map((character) => {
    const previous = state.characters.find((item) => item.id === character.id);
    if (!previous) return character;
    const merged = { ...character };
    // Портрет и ручной выбор голоса переживают повторный анализ книги.
    if (!character.backendManaged && previous.portraitUri && !character.portraitUri) {
      merged.portraitUri = previous.portraitUri;
      merged.portraitUriOverridesAsset = previous.portraitUriOverridesAsset;
    }
    if (!character.backendManaged && previous.portraitAssetId && !character.portraitAssetId) {
      merged.portraitAssetId = previous.portraitAssetId;
    }
    if (previous.voiceOverride && !character.voiceOverride) {
      merged.voiceOverride = previous.voiceOverride;
    }
    // Ударение имени (P9) не теряется, если новый анализ его не вернул.
    if (previous.stressedName && !character.stressedName) {
      merged.stressedName = previous.stressedName;
    }
    return sameCharacterData(previous, merged) ? previous : merged;
  });
  const unchangedCharacters =
    state.characters.length === nextCharacters.length &&
    state.characters.every((character, index) => character === nextCharacters[index]);

  return {
    ...state,
    characters: unchangedCharacters ? state.characters : nextCharacters,
    analyzedAt,
    analysisError: undefined,
  };
}

/** Compare the complete JSON-shaped character, including data used by chat and
 * portrait generation. Optional absence and undefined have the same value;
 * a defined field that was removed or changed must still replace the object. */
function sameCharacterData(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true;
  if (Array.isArray(previous) || Array.isArray(next)) {
    return (
      Array.isArray(previous) &&
      Array.isArray(next) &&
      previous.length === next.length &&
      previous.every((value, index) => sameCharacterData(value, next[index]))
    );
  }
  if (!previous || !next || typeof previous !== "object" || typeof next !== "object") return false;
  const prototype = Object.getPrototypeOf(previous);
  if (
    prototype !== Object.getPrototypeOf(next) ||
    (prototype !== Object.prototype && prototype !== null)
  )
    return false;

  const a = previous as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (!sameCharacterData(a[key], b[key])) return false;
  return true;
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
