export function normalizeCharacterChatPlaceholder(value: string): string | null {
  const firstLine = value
    .trim()
    .split(/\r?\n/u)[0]
    ?.replace(/^(?:placeholder\s*:\s*)/iu, "")
    .replace(/^["«„“]+|["»“”]+$/gu, "")
    .trim()
    .replace(/\.{3}$/u, "…");

  if (!firstLine || firstLine.length > 80 || !/^Написать\s+\S/iu.test(firstLine)) return null;
  return /[.!?…]$/u.test(firstLine) ? firstLine : `${firstLine}…`;
}
