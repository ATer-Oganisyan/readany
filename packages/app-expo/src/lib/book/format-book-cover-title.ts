const NON_BREAKING_SPACE = "\u00A0";
const ONE_LETTER_SERVICE_WORDS = new Set(["а", "в", "и", "к", "о", "с", "у"]);
const SENTENCE_BOUNDARY_WITH_CONTINUATION = /[.!?…]+(?=\s+\S)/u;

function keepOnlyFirstSentence(title: string): string {
  const trimmedTitle = title.trim();
  const firstBoundaryIndex = trimmedTitle.search(SENTENCE_BOUNDARY_WITH_CONTINUATION);

  return firstBoundaryIndex >= 0
    ? trimmedTitle.slice(0, firstBoundaryIndex).trimEnd()
    : trimmedTitle;
}

/** Shortens multi-sentence titles and keeps one-letter service words with the following word. */
export function formatBookCoverTitle(title: string): string {
  const tokens = keepOnlyFirstSentence(title).split(/(\s+)/u);

  for (let index = 0; index < tokens.length - 2; index += 1) {
    const token = tokens[index];
    const separator = tokens[index + 1];
    const nextToken = tokens[index + 2];

    if (
      ONE_LETTER_SERVICE_WORDS.has(token.toLocaleLowerCase("ru-RU")) &&
      /^\s+$/u.test(separator) &&
      nextToken.length > 0
    ) {
      tokens[index + 1] = NON_BREAKING_SPACE;
    }
  }

  return tokens.join("");
}
