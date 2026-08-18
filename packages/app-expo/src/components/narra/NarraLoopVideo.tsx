/**
 * Нативное зацикленное видео «ожившей» картинки (P18) поверх статичного кадра.
 *
 * `VideoView` из expo-video остаётся нативным слоем: картинка под ним видна,
 * пока нативный плеер не отрисовал первый кадр.
 */

import { useEvent } from "expo";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEffect } from "react";
import { type StyleProp, StyleSheet, type ViewStyle } from "react-native";

interface NarraLoopVideoProps {
  /** file://-URI или URI локального mp4-файла. */
  uri: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  onReady?: () => void;
  onError?: () => void;
}

export function NarraLoopVideo({
  uri,
  style,
  accessibilityLabel,
  onReady,
  onError,
}: NarraLoopVideoProps) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });

  useEffect(() => {
    if (status === "error") onError?.();
  }, [onError, status]);

  return (
    <VideoView
      accessibilityLabel={accessibilityLabel}
      allowsPictureInPicture={false}
      contentFit="contain"
      nativeControls={false}
      onFirstFrameRender={onReady}
      player={player}
      playsInline
      style={[styles.video, style]}
      useExoShutter={false}
    />
  );
}

const styles = StyleSheet.create({
  video: { width: "100%", height: "100%", backgroundColor: "transparent" },
});
