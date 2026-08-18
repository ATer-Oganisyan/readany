import { type MishanaerIconName, getStrokeIconImageSource } from "@/components/ui/MishanaerIcon";
import { useTheme } from "@/styles/theme";
import {
  CircularProgressIndicator,
  Column,
  FilledIconButton,
  Host,
  Icon,
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

function PlayerIcon({ name, color }: { name: MishanaerIconName; color: string }) {
  return (
    <Icon
      source={getStrokeIconImageSource(name)}
      size={26}
      tint={color}
      contentDescription={name}
    />
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
            <PlayerIcon name="skip-backward" color={colors.foreground} />
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
              <PlayerIcon
                name={player.isPlaying ? "pause" : "play"}
                color={colors.primaryForeground}
              />
            )}
          </FilledIconButton>
          <Spacer modifiers={[size(22, 1)]} />
          <IconButton
            onClick={player.seekForward}
            enabled={player.hasDuration}
            colors={{ contentColor: colors.foreground }}
          >
            <PlayerIcon name="skip-forward" color={colors.foreground} />
          </IconButton>
        </Row>
      </Column>
    </Host>
  );
}

export type { TTSNativePlayerProps } from "./TTSNativePlayer.types";
