export function previousParagraphIndex(
  paragraphIds: readonly (string | undefined)[],
  currentIndex: number,
): number | null {
  const current = paragraphIds[currentIndex];
  if (!current) return null;
  let index = currentIndex;
  while (index > 0 && paragraphIds[index - 1] === current) index--;
  if (index === 0) return 0;
  const previous = paragraphIds[index - 1];
  if (!previous) return null;
  index--;
  while (index > 0 && paragraphIds[index - 1] === previous) index--;
  return index;
}
