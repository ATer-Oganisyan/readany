import type { NarraBookState } from "./types";

export const CURRENT_PORTRAIT_PROMPT_VERSION = 2;

interface PersistedNarraPortraitState {
  books: Record<string, NarraBookState>;
  portraitPromptVersion?: number;
}

/**
 * Одноразово сбрасывает портреты, созданные старой версией промпта.
 * Встроенные каталожные ассеты остаются на месте; пользовательские книги
 * получат новые портреты штатной фоновой очередью после обновления.
 */
export function migrateGeneratedFemalePortraits<T extends PersistedNarraPortraitState>(
  state: T,
): T & { portraitPromptVersion: number } {
  if ((state.portraitPromptVersion ?? 0) >= CURRENT_PORTRAIT_PROMPT_VERSION) {
    return state as T & { portraitPromptVersion: number };
  }

  return {
    ...state,
    portraitPromptVersion: CURRENT_PORTRAIT_PROMPT_VERSION,
    books: Object.fromEntries(
      Object.entries(state.books).map(([bookId, book]) => [
        bookId,
        {
          ...book,
          characters: book.characters.map((character) => {
            if (
              character.gender !== "female" ||
              !character.passport ||
              character.passport.age < 18 ||
              !character.portraitUri
            ) {
              return character;
            }

            return {
              ...character,
              portraitUri: undefined,
              portraitUriOverridesAsset: false,
            };
          }),
        },
      ]),
    ),
  };
}
