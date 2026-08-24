import { bookIdentity } from "./book-identity";

export const LOADING_COVER_COLORS = ["#753F13", "#911C13", "#274D28", "#1C4682"] as const;

export function loadingCoverColorForBook(bookId: string): string {
  let hash = 2_166_136_261;

  for (const character of bookId) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16_777_619);
  }

  return (
    LOADING_COVER_COLORS[(hash >>> 0) % LOADING_COVER_COLORS.length] ?? LOADING_COVER_COLORS[0]
  );
}

/**
 * Цвет заглушки по названию и автору. Один и тот же для книги в каталоге и в
 * библиотеке, потому что не зависит от локального id.
 */
export function loadingCoverColorForTitleAuthor(input: { title: string; author?: string }): string {
  return loadingCoverColorForBook(bookIdentity(input.title, input.author ?? ""));
}
