import { Image, type ImageSourcePropType } from "react-native";
import { CATALOG_CHARACTER_PORTRAIT_ASSETS } from "./catalog-character-portrait-assets";
import { CATALOG_CHARACTER_VIDEO_ASSETS } from "./catalog-character-video-assets";
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

type CharacterPortraitFields = Pick<
  NarraCharacter,
  "portraitAssetId" | "portraitUri" | "portraitUriOverridesAsset"
>;

/**
 * Returns Image sources in display priority order.
 *
 * Bundled assets deliberately stay as numeric `require(...)` sources. Converting
 * them to `{ uri }` makes Metro URLs look valid even when React Native cannot
 * render them, which also prevents the UI from showing its initials fallback.
 */
export function resolveCharacterPortraitSources(
  character: CharacterPortraitFields | null | undefined,
): ImageSourcePropType[] {
  if (!character) return [];

  const persistedSource = character.portraitUri
    ? { uri: normalizePersistedNarraMediaUri(character.portraitUri) }
    : undefined;
  const bundledSource = character.portraitAssetId
    ? CATALOG_CHARACTER_PORTRAIT_ASSETS[character.portraitAssetId]
    : undefined;

  if (character.portraitUriOverridesAsset) {
    return [persistedSource, bundledSource].filter(
      (source): source is ImageSourcePropType => source !== undefined,
    );
  }

  return [bundledSource, persistedSource].filter(
    (source): source is ImageSourcePropType => source !== undefined,
  );
}

export function resolveCharacterPortraitSource(
  character: CharacterPortraitFields | null | undefined,
): ImageSourcePropType | undefined {
  return resolveCharacterPortraitSources(character)[0];
}

/** Returns the bundled loop for a catalog character unless a custom portrait overrides it. */
export function resolveCharacterPortraitVideoAsset(
  character: CharacterPortraitFields | null | undefined,
): number | undefined {
  if (!character || character.portraitUriOverridesAsset || !character.portraitAssetId) {
    return undefined;
  }
  return CATALOG_CHARACTER_VIDEO_ASSETS[character.portraitAssetId];
}

/** Resolves user-generated files and bundled catalog assets to one Image-compatible URI. */
export function resolveCharacterPortraitUri(
  character: CharacterPortraitFields | null | undefined,
): string | undefined {
  const source = resolveCharacterPortraitSource(character);
  if (!source) return undefined;
  if (typeof source !== "number" && "uri" in source) return source.uri;
  return Image.resolveAssetSource(source)?.uri;
}
