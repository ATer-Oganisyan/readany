import { Image } from "react-native";
import { CATALOG_CHARACTER_PORTRAIT_ASSETS } from "./catalog-character-portrait-assets";
import { normalizePersistedNarraMediaUri } from "./media";
import type { NarraCharacter } from "./types";

export function hasCharacterPortrait(
  character: Pick<NarraCharacter, "portraitAssetId" | "portraitUri">,
): boolean {
  return Boolean(
    character.portraitUri ||
      (character.portraitAssetId && CATALOG_CHARACTER_PORTRAIT_ASSETS[character.portraitAssetId]),
  );
}

/** Resolves user-generated files and bundled catalog assets to one Image-compatible URI. */
export function resolveCharacterPortraitUri(
  character: Pick<NarraCharacter, "portraitAssetId" | "portraitUri"> | null | undefined,
): string | undefined {
  if (!character) return undefined;
  if (character.portraitUri) return normalizePersistedNarraMediaUri(character.portraitUri);
  if (!character.portraitAssetId) return undefined;
  const source = CATALOG_CHARACTER_PORTRAIT_ASSETS[character.portraitAssetId];
  return source ? Image.resolveAssetSource(source)?.uri : undefined;
}
