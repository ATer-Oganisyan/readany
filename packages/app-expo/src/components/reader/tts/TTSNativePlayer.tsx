import { PauseIcon, PlayIcon, RotateCcwIcon, SkipForwardIcon } from "@/components/ui/Icon";
import { useTheme, withOpacity } from "@/styles/theme";
import { Pressable, StyleSheet, View } from "react-native";
import { ReadingProgressSlider } from "../ReadingProgressSlider";
import type { TTSNativePlayerProps } from "./TTSNativePlayer.types";
import { useTTSNativePlayer } from "./useTTSNativePlayer";

export function TTSNativePlayer({
  playState,
  onPlayPause,
  chapterCurrentIndex,
  chapterTotalChunks,
  onSeekChapterChunk,
}: TTSNativePlayerProps) {
  const { colors } = useTheme();
  const player = useTTSNativePlayer(playState, onPlayPause, {
    chapterCurrentIndex,
    chapterTotalChunks,
    onSeekChapterChunk,
  });
  const fraction = player.hasDuration ? player.localPosition / player.duration : 0;

  return (
    <View style={styles.container}>
      <ReadingProgressSlider
        progress={fraction}
        onDragStart={player.beginSeeking}
        onDragEnd={player.commitSeeking}
        onSeek={(nextFraction) => player.setPosition(nextFraction * player.duration)}
        accentColor={colors.primary}
        trackColor={withOpacity(colors.foreground, 0.12)}
        textColor={colors.mutedForeground}
      />
      <View style={styles.controls}>
        <Pressable onPress={player.seekBackward} style={styles.control}>
          <RotateCcwIcon size={24} color={colors.foreground} />
        </Pressable>
        <Pressable
          onPress={player.togglePlayback}
          style={[styles.play, { backgroundColor: colors.primary }]}
        >
          {player.isPlaying ? (
            <PauseIcon size={24} color={colors.primaryForeground} />
          ) : (
            <PlayIcon size={24} color={colors.primaryForeground} />
          )}
        </Pressable>
        <Pressable onPress={player.seekForward} style={styles.control}>
          <SkipForwardIcon size={24} color={colors.foreground} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 18, paddingVertical: 8 },
  controls: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 28 },
  control: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  play: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
});

export type { TTSNativePlayerProps } from "./TTSNativePlayer.types";
