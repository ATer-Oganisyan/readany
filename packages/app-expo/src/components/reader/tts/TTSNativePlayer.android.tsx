import { useTheme } from "@/styles/theme";
import { interfaceFontFamily } from "@deslop/primitives/native";
import {
  CircularProgressIndicator,
  Column,
  FilledIconButton,
  Host,
  IconButton,
  Row,
  Slider,
  Spacer,
  Text,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth, padding, size } from "@expo/ui/jetpack-compose/modifiers";
import type { TTSNativePlayerProps } from "./TTSNativePlayer.types";
import { useTTSNativePlayer } from "./useTTSNativePlayer";

const PLAYER_HEIGHT = 132;

function PlayerIcon({ children, color }: { children: string; color: string }) {
  return (
    <Text color={color} style={{ fontFamily: interfaceFontFamily.materialSymbols, fontSize: 26 }}>
      {children}
    </Text>
  );
}

export function TTSNativePlayer({
  playState,
  onPlayPause,
  chapterCurrentIndex,
  chapterTotalChunks,
  onSeekChapterChunk,
}: TTSNativePlayerProps) {
  const { colors, isDark } = useTheme();
  const player = useTTSNativePlayer(playState, onPlayPause, {
    chapterCurrentIndex,
    chapterTotalChunks,
    onSeekChapterChunk,
  });
  const sliderMax = Math.max(player.duration, 1);

  return (
    <Host colorScheme={isDark ? "dark" : "light"} style={{ width: "100%", height: PLAYER_HEIGHT }}>
      <Column modifiers={[fillMaxWidth(), padding(16, 0, 16, 0)]}>
        <Slider
          value={player.hasDuration ? player.localPosition : 0}
          min={0}
          max={sliderMax}
          enabled={player.hasDuration}
          onValueChange={(value) => {
            player.beginSeeking();
            player.setPosition(value);
          }}
          onValueChangeFinished={player.commitSeeking}
          colors={{
            thumbColor: colors.primary,
            activeTrackColor: colors.primary,
            inactiveTrackColor: colors.border,
          }}
          modifiers={[fillMaxWidth()]}
        />

        <Row horizontalArrangement="spaceBetween" modifiers={[fillMaxWidth()]}>
          <Text color={colors.mutedForeground} style={{ fontSize: 12, fontFamily: "monospace" }}>
            {player.progressLabel}
          </Text>
          <Text color={colors.mutedForeground} style={{ fontSize: 12, fontFamily: "monospace" }}>
            {player.durationLabel}
          </Text>
        </Row>

        <Row horizontalArrangement="center" verticalAlignment="center" modifiers={[fillMaxWidth()]}>
          <IconButton
            onClick={player.seekBackward}
            enabled={player.hasDuration}
            colors={{ contentColor: colors.foreground }}
          >
            <PlayerIcon color={colors.foreground}>replay_15</PlayerIcon>
          </IconButton>
          <Spacer modifiers={[size(22, 1)]} />
          <FilledIconButton
            onClick={player.togglePlayback}
            colors={{
              containerColor: colors.primary,
              contentColor: colors.primaryForeground,
            }}
          >
            {player.isLoading ? (
              <CircularProgressIndicator
                color={colors.primaryForeground}
                strokeWidth={2.5}
                modifiers={[size(24, 24)]}
              />
            ) : (
              <PlayerIcon color={colors.primaryForeground}>
                {player.isPlaying ? "pause" : "play_arrow"}
              </PlayerIcon>
            )}
          </FilledIconButton>
          <Spacer modifiers={[size(22, 1)]} />
          <IconButton
            onClick={player.seekForward}
            enabled={player.hasDuration}
            colors={{ contentColor: colors.foreground }}
          >
            <PlayerIcon color={colors.foreground}>forward_15</PlayerIcon>
          </IconButton>
        </Row>
      </Column>
    </Host>
  );
}

export type { TTSNativePlayerProps } from "./TTSNativePlayer.types";
