import {
  SystemSheetZoomSource,
  prepareSheetZoom,
} from "@/components/navigation/SystemSheetZoomSource";
import { getFilledIconImageSource } from "@/components/ui/MishanaerIcon";
import { navigate } from "@/lib/navigationRef";
import { previousParagraphIndex } from "@/lib/tts-paragraph-navigation";
import { useTTSStore } from "@/stores/tts-store";
import { useColors } from "@/styles/theme";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Image, Platform, PlatformColor, Pressable, StyleSheet, Text, View } from "react-native";
import PreviousParagraphIcon from "../../../assets/icons/sentence-backward.svg";
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
  const playing = playState === "playing" || playState === "loading";
  const LABEL = Platform.OS === "ios" ? PlatformColor("label") : colors.foreground;
  const SECONDARY_LABEL =
    Platform.OS === "ios" ? PlatformColor("secondaryLabel") : colors.mutedForeground;
  const sourceId = useId();
  const onOpen = async () => {
    await prepareSheetZoom(sourceId);
    navigate("AudiobookPlayer", { sourceId });
  };
  const previousIndex = useTTSStore((s) =>
    previousParagraphIndex(s.paragraphIds, s.currentChunkIndex),
  );
  const onPrevious = () => {
    const state = useTTSStore.getState();
    const index = previousParagraphIndex(state.paragraphIds, state.currentChunkIndex);
    if (index !== null) state.jumpToChunk(index);
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(playing ? "tts.pause" : "tts.playShort")}
          onPress={() => toggle()}
          hitSlop={8}
        >
          <Image
            source={getFilledIconImageSource(playing ? "pause" : "play")}
            style={{ width: 16, height: 16, tintColor: LABEL }}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("tts.previousParagraph")}
          accessibilityState={{ disabled: previousIndex === null }}
          disabled={previousIndex === null}
          onPress={onPrevious}
          hitSlop={8}
        >
          <PreviousParagraphIcon
            width={18}
            height={18}
            color={LABEL}
            opacity={previousIndex === null ? 0.35 : 1}
          />
        </Pressable>
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
          <Text numberOfLines={1} style={[styles.artist, { color: SECONDARY_LABEL }]}>
            {chapter}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(playing ? "tts.pause" : "tts.playShort")}
        onPress={() => toggle()}
        hitSlop={8}
        style={styles.button}
      >
        <Image
          source={getFilledIconImageSource(playing ? "pause" : "play")}
          style={{ width: 20, height: 20, tintColor: LABEL }}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("tts.previousParagraph")}
        accessibilityState={{ disabled: previousIndex === null }}
        disabled={previousIndex === null}
        onPress={onPrevious}
        hitSlop={8}
        style={styles.button}
      >
        <PreviousParagraphIcon
          width={18}
          height={18}
          style={{ margin: 2 }}
          color={LABEL}
          opacity={previousIndex === null ? 0.35 : 1}
        />
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
    fontSize: 13,
  },
  button: {
    padding: 6,
  },
  // The trailing inset is far wider than the leading one: the glyph is
  // floating text, not a bounded card, so it needs generous room to clear
  // the capsule curve.
  inlineRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 16,
    paddingRight: 24,
  },
  inlineTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
});
