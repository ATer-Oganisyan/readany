import { resolveCharacterPortraitSources } from "@/lib/narra/character-portrait";
import type { NarraCharacter } from "@/lib/narra/types";
import { type ReactNode, useState } from "react";
import { Image, type ImageResizeMode, type ImageStyle, type StyleProp } from "react-native";

interface CharacterPortraitImageProps {
  character: Pick<NarraCharacter, "portraitAssetId" | "portraitUri" | "portraitUriOverridesAsset">;
  fallback: ReactNode;
  resizeMode?: ImageResizeMode;
  style?: StyleProp<ImageStyle>;
}

export function CharacterPortraitImage({
  character,
  fallback,
  resizeMode = "cover",
  style,
}: CharacterPortraitImageProps) {
  const sourceKey = `${character.portraitAssetId ?? ""}|${character.portraitUri ?? ""}|${
    character.portraitUriOverridesAsset ? "override" : "default"
  }`;
  const sources = resolveCharacterPortraitSources(character);
  const [selection, setSelection] = useState({ key: sourceKey, index: 0 });
  const sourceIndex = selection.key === sourceKey ? selection.index : 0;

  const source = sources[sourceIndex];
  if (!source) return fallback;

  return (
    <Image
      source={source}
      resizeMode={resizeMode}
      style={style}
      onError={() => setSelection({ key: sourceKey, index: sourceIndex + 1 })}
    />
  );
}
