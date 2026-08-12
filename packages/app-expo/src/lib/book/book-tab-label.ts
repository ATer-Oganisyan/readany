const SHORT_FUNCTION_WORDS = new Set([
  "а",
  "без",
  "в",
  "во",
  "для",
  "до",
  "за",
  "и",
  "из",
  "или",
  "к",
  "ко",
  "на",
  "над",
  "о",
  "об",
  "от",
  "по",
  "под",
  "при",
  "с",
  "со",
  "у",
]);

function normalizedWord(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function getBookTabLabel(title: string): string {
  const normalizedTitle = title.trim().replace(/\s+/gu, " ");
  const firstSentence = normalizedTitle.split(/[.!?…]+(?=\s|$)/u)[0]?.trim() || normalizedTitle;
  const words = firstSentence.split(" ").filter(Boolean);
  if (words.length <= 2) return firstSentence;

  const firstThreeWords = words.slice(0, 3);
  const includesFunctionWord = firstThreeWords.some((word) =>
    SHORT_FUNCTION_WORDS.has(normalizedWord(word)),
  );
  const visibleWordCount = includesFunctionWord ? 3 : 2;
  if (words.length <= visibleWordCount) return firstSentence;

  return `${words.slice(0, visibleWordCount).join(" ")}…`;
}
