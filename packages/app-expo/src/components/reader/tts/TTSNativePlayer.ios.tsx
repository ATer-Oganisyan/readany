import { useTheme } from "@/styles/theme";
import { Host, Slider, Text as SwiftUIText, VStack } from "@expo/ui/swift-ui";
import {
  Animation,
  animation,
  contentTransition,
  disabled,
  frame,
  monospacedDigit,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import { View } from "react-native";
import type { TTSNativePlayerProps } from "./TTSNativePlayer.types";
import { useTTSNativePlayer } from "./useTTSNativePlayer";

const SLIDER_HEIGHT = 54;
const TOOLBAR_HEIGHT = 50;
const PLAYER_HEIGHT = SLIDER_HEIGHT + TOOLBAR_HEIGHT;

interface NativeTTSPlayerToolbarProps {
  tintColor: string;
  primaryColor: string;
  primaryForegroundColor: string;
  isDark: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  seekEnabled: boolean;
  onBackwardPress: () => void;
  onPlayPausePress: () => void;
  onForwardPress: () => void;
  style: { width: "100%"; height: number };
}

const NativeTTSPlayerToolbar = requireNativeView(
  "ReadAnyNativeControls",
  "ReadAnyTTSPlayerToolbar",
) as ComponentType<NativeTTSPlayerToolbarProps>;

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
    <View style={{ width: "100%", height: PLAYER_HEIGHT }}>
      <Host
        colorScheme={isDark ? "dark" : "light"}
        style={{ width: "100%", height: SLIDER_HEIGHT }}
      >
        <VStack
          spacing={0}
          modifiers={[padding({ horizontal: 20, vertical: 8 }), frame({ maxWidth: 10_000 })]}
        >
          <Slider
            value={player.hasDuration ? player.localPosition : 0}
            min={0}
            max={sliderMax}
            minimumValueLabel={
              <SwiftUIText
                modifiers={[
                  monospacedDigit(),
                  contentTransition("numericText"),
                  animation(Animation.default, player.progressPercent),
                ]}
              >
                {`${player.progressPercent}%`}
              </SwiftUIText>
            }
            onValueChange={player.setPosition}
            onEditingChanged={(editing) => {
              if (editing) player.beginSeeking();
              else player.commitSeeking();
            }}
            modifiers={[
              frame({ maxWidth: 10_000 }),
              tint(colors.primary),
              disabled(!player.hasDuration),
            ]}
          />
        </VStack>
      </Host>

      <NativeTTSPlayerToolbar
        tintColor={colors.foreground}
        primaryColor={colors.primary}
        primaryForegroundColor={colors.primaryForeground}
        isDark={isDark}
        isPlaying={player.isPlaying}
        isLoading={player.isLoading}
        seekEnabled={player.hasDuration}
        onBackwardPress={player.seekBackward}
        onPlayPausePress={player.togglePlayback}
        onForwardPress={player.seekForward}
        style={{ width: "100%", height: TOOLBAR_HEIGHT }}
      />
    </View>
  );
}

export type { TTSNativePlayerProps } from "./TTSNativePlayer.types";
