import { normalizeBookIdentityValue } from "./book-identity-resolver";

const NON_BREAKING_SPACE = "\u00A0";
const SENTENCE_BOUNDARY_WITH_CONTINUATION = /[.!?…]+(?=\s+\S)/u;

function isShortWord(value: string): boolean {
  const normalizedWord = value.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const characterCount = Array.from(normalizedWord).length;

  return characterCount >= 1 && characterCount <= 2;
}

function keepOnlyFirstSentence(title: string): string {
  const trimmedTitle = normalizeBookIdentityValue(title);
  const firstBoundaryIndex = trimmedTitle.search(SENTENCE_BOUNDARY_WITH_CONTINUATION);

  return firstBoundaryIndex >= 0
    ? trimmedTitle.slice(0, firstBoundaryIndex).trimEnd()
    : trimmedTitle;
}

/** Shortens multi-sentence titles and keeps one- or two-character words with the following word. */
export function formatBookCoverTitle(title: string): string {
  const tokens = keepOnlyFirstSentence(title).split(/(\s+)/u);

  for (let index = 0; index < tokens.length - 2; index += 1) {
    const token = tokens[index];
    const separator = tokens[index + 1];
    const nextToken = tokens[index + 2];

    if (isShortWord(token) && /^\s+$/u.test(separator) && nextToken.length > 0) {
      tokens[index + 1] = NON_BREAKING_SPACE;
    }
  }

  return tokens.join("");
}

export function formatBookCoverAuthor(author?: string): string {
  return normalizeBookIdentityValue(author, 180);
}

export function formatBookCoverIdentity(
  title: string,
  author?: string,
): { title: string; author: string; text: string } {
  const formattedTitle = formatBookCoverTitle(title);
  const formattedAuthor = formatBookCoverAuthor(author);
  return {
    title: formattedTitle,
    author: formattedAuthor,
    text: [formattedTitle, formattedAuthor].filter(Boolean).join("\n"),
  };
}
