import {
  SystemSheetZoomSource,
  prepareSheetZoom,
} from "@/components/navigation/SystemSheetZoomSource";
import { useTTSBuffering } from "@/components/reader/tts/useTTSNativePlayer";
import { MishanaerIcon } from "@/components/ui/MishanaerIcon";
import { hapticLight } from "@/lib/haptics";
import { navigate } from "@/lib/navigationRef";
import { useTTSStore } from "@/stores/tts-store";
import { subtitleTypography, useColors } from "@/styles/theme";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Platform, PlatformColor, Pressable, StyleSheet, Text, View } from "react-native";
import { AnimatedPlayPause } from "./animated-play-pause";
import { AudiobookCover } from "./audiobook-cover";
// Source: expo-ui-examples/mini-player/mini-player-accessory.tsx (MIT).

// Both placements share the audiobook store; minimizing never restarts audio.
export function AudiobookPlayerAccessory({
  placement = "regular",
}: { placement?: "regular" | "inline" }) {
  const colors = useColors();
  const { t } = useTranslation();
  const title = useTTSStore((s) => s.currentBookTitle);
  const chapter = useTTSStore((s) => s.currentChapterTitle);
  const playState = useTTSStore((s) => s.playState);
  const toggle = useTTSStore((s) => s.toggle);
  const stop = useTTSStore((s) => s.stop);
  const { buffering, confirmedBuffering } = useTTSBuffering(playState);
  const isLoading =
    playState === "loading" || (playState === "playing" && buffering && confirmedBuffering);
  const playing = playState === "playing" || playState === "loading";
  const LABEL = Platform.OS === "ios" ? PlatformColor("label") : colors.foreground;
  const SECONDARY_LABEL =
    Platform.OS === "ios" ? PlatformColor("secondaryLabel") : colors.mutedForeground;
  const sourceId = useId();
  const onOpen = async () => {
    hapticLight();
    await prepareSheetZoom(sourceId);
    navigate("AudiobookPlayer", { sourceId });
  };
  // 'inline' is the wide pill riding next to the collapsed tab circle once the
  // bar minimizes, not an icon-sized slot — so it keeps the artwork, title, and
  // transport controls, dropping the chapter line to fit.
  // Pressing the pill opens the full player; the glyph is its own pressable so
  // play/pause still works without expanding.
  if (placement === "inline") {
    return (
      <SystemSheetZoomSource sourceId={sourceId} style={styles.inlineRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("tts.openAudiobookPlayer", { title })}
          onPress={onOpen}
          style={[styles.openArea, { gap: 8 }]}
        >
          <AudiobookCover height={32} />
          <Text numberOfLines={1} style={[styles.inlineTitle, { color: LABEL }]}>
            {title}
          </Text>
        </Pressable>
        <View style={styles.inlineControls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(playing ? "tts.pause" : "tts.playShort")}
            onPress={() => {
              hapticLight();
              toggle();
            }}
            hitSlop={{ top: 6, bottom: 6 }}
            style={styles.closeButton}
          >
            <AnimatedPlayPause
              isPlaying={playing}
              isLoading={isLoading}
              color={colors.foreground}
              size={16}
              containerSize={32}
            />
          </Pressable>
        </View>
      </SystemSheetZoomSource>
    );
  }

  return (
    <SystemSheetZoomSource sourceId={sourceId} style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("tts.openAudiobookPlayer", { title })}
        onPress={onOpen}
        style={styles.openArea}
      >
        <AudiobookCover height={32} />
        <View style={styles.info}>
          <Text numberOfLines={1} style={[styles.title, { color: LABEL }]}>
            {title}
          </Text>
          {!!chapter?.trim() && (
            <Text numberOfLines={1} style={[styles.artist, { color: SECONDARY_LABEL }]}>
              {chapter}
            </Text>
          )}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(playing ? "tts.pause" : "tts.playShort")}
        onPress={() => {
          hapticLight();
          toggle();
        }}
        hitSlop={8}
        style={styles.button}
      >
        <AnimatedPlayPause
          isPlaying={playing}
          isLoading={isLoading}
          color={colors.foreground}
          size={20}
          containerSize={32}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
        onPressIn={hapticLight}
        onPress={stop}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        style={styles.closeButton}
      >
        <MishanaerIcon name="x" size={28.8} color={colors.foreground} />
      </Pressable>
    </SystemSheetZoomSource>
  );
}

const styles = StyleSheet.create({
  // Measured off Apple Music's own 48pt-capsule accessory: 32pt artwork with
  // a ~15pt leading inset and 8pt vertical margins, so the art floats inside
  // the capsule's curve instead of hugging it.
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingLeft: 15,
    paddingRight: 14,
  },
  // The artwork + text block is the tap-to-open target, matching Apple Music;
  // the transport buttons stay their own targets.
  openArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
  },
  artist: {
    ...subtitleTypography,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    width: 44,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineControls: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  inlineRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 16,
    paddingRight: 16,
  },
  inlineTitle: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
});
