import type { ImageSourcePropType } from "react-native";
import { normalizePersistedNarraMediaUri } from "./media";
import type { NarraCharacter } from "./types";

export function hasCharacterPortrait(
  character: Pick<NarraCharacter, "portraitAssetId" | "portraitUri">,
): boolean {
  return Boolean(character.portraitUri);
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
  return persistedSource ? [persistedSource] : [];
}

export function resolveCharacterPortraitSource(
  character: CharacterPortraitFields | null | undefined,
): ImageSourcePropType | undefined {
  return resolveCharacterPortraitSources(character)[0];
}

/** Resolves a generated, user-overridden, or backend-cached portrait URI. */
export function resolveCharacterPortraitUri(
  character: CharacterPortraitFields | null | undefined,
): string | undefined {
  const source = resolveCharacterPortraitSource(character);
  if (!source) return undefined;
  return typeof source !== "number" && "uri" in source ? source.uri : undefined;
}
