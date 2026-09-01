import type { NarraCharacter } from "./types";

function nonEmptyText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

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

/** Canonical biography for every character surface. New manifests provide
 * description; role is retained only for persisted legacy responses. */
export function characterBiography(character: NarraCharacter): string | undefined {
  return (
    characterProfileText(character, "description") ||
    nonEmptyText(character.description) ||
    nonEmptyText(character.role)
  );
}
