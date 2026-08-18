import { NarraLoopVideo } from "@/components/narra/NarraLoopVideo";
import {
  resolveCharacterPortraitSources,
  resolveCharacterPortraitVideoAsset,
} from "@/lib/narra/character-portrait";
import type { NarraCharacter } from "@/lib/narra/types";
import { Asset } from "expo-asset";
import { type ReactNode, useEffect, useState } from "react";
import {
  Image,
  type ImageResizeMode,
  type ImageStyle,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

interface CharacterPortraitImageProps {
  character: Pick<NarraCharacter, "portraitAssetId" | "portraitUri" | "portraitUriOverridesAsset">;
  fallback: ReactNode;
  staticOnly?: boolean;
  resizeMode?: ImageResizeMode;
  style?: StyleProp<ImageStyle>;
}

export function CharacterPortraitImage({
  character,
  fallback,
  staticOnly = false,
  resizeMode = "cover",
  style,
}: CharacterPortraitImageProps) {
  const sourceKey = `${character.portraitAssetId ?? ""}|${character.portraitUri ?? ""}|${
    character.portraitUriOverridesAsset ? "override" : "default"
  }`;
  const sources = resolveCharacterPortraitSources(character);
  const videoAsset = staticOnly ? undefined : resolveCharacterPortraitVideoAsset(character);
  const [selection, setSelection] = useState({ key: sourceKey, index: 0 });
  const [videoState, setVideoState] = useState<{
    key: string;
    uri?: string;
    failed: boolean;
    ready: boolean;
  }>({ key: sourceKey, failed: false, ready: false });
  const sourceIndex = selection.key === sourceKey ? selection.index : 0;
  const videoUri = videoState.key === sourceKey && !videoState.failed ? videoState.uri : undefined;
  const videoReady =
    videoState.key === sourceKey && !videoState.failed && videoState.ready && Boolean(videoUri);

  useEffect(() => {
    let cancelled = false;
    setVideoState({ key: sourceKey, failed: false, ready: false });
    if (typeof videoAsset !== "number") return () => undefined;

    const asset = Asset.fromModule(videoAsset);
    const immediateUri = asset.localUri || asset.uri;
    if (immediateUri) {
      setVideoState({ key: sourceKey, uri: immediateUri, failed: false, ready: false });
    }

    void asset
      .downloadAsync()
      .then(() => {
        if (cancelled) return;
        const uri = asset.localUri || asset.uri;
        if (uri) setVideoState({ key: sourceKey, uri, failed: false, ready: false });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [sourceKey, videoAsset]);

  if (videoUri) {
    const source = sources[sourceIndex];
    return (
      <View style={style as StyleProp<ViewStyle>}>
        <NarraLoopVideo
          accessibilityLabel="Зацикленный портрет персонажа"
          onError={() =>
            setVideoState({ key: sourceKey, uri: videoUri, failed: true, ready: false })
          }
          onReady={() =>
            setVideoState({ key: sourceKey, uri: videoUri, failed: false, ready: true })
          }
          style={StyleSheet.absoluteFill}
          uri={videoUri}
        />
        {!videoReady ? (
          source ? (
            <Image
              source={source}
              resizeMode={resizeMode}
              style={StyleSheet.absoluteFill}
              onError={() => setSelection({ key: sourceKey, index: sourceIndex + 1 })}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.fallback]}>{fallback}</View>
          )
        ) : null}
      </View>
    );
  }

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

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
});
