import type { NarraCharacter } from "./types";

export function characterProfileText(character: NarraCharacter, key: string): string | undefined {
  const value = character.profileDetails?.find((detail) => detail.key === key)?.value;
  if (Array.isArray(value)) {
    const text = value
      .map((item) => item.trim())
      .filter(Boolean)
      .join(" ");
    return text || undefined;
  }
  const text = value?.trim();
  return text || undefined;
}
