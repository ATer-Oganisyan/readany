const NON_BREAKING_SPACE = "\u00A0";
const WORD_JOINER = "\u2060";
const ONE_LETTER_SERVICE_WORDS = new Set(["а", "в", "и", "к", "о", "с", "у"]);

/** Keeps one-letter Russian prepositions and conjunctions with the following word. */
export function formatBookCoverTitle(title: string): string {
  const tokens = title.split(/(\s+)/u);

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

  return tokens.join("").replace(/\S+/gu, (word) => Array.from(word).join(WORD_JOINER));
}
