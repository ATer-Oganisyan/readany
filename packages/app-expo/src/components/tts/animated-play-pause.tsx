import LottieView from "lottie-react-native";
import { memo, useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";
import animation from "../../../assets/icons/anim_play_loader_pause.json";
import { createMotion, sampleMotion } from "../../lib/tts-motion/playback-motion";
import type { MotionDirection, MotionTarget } from "../../lib/tts-motion/playback-motion";

const AnimatedLottieView = Animated.createAnimatedComponent(LottieView);
const frameRatio = animation.fr / animation.op;

export const AnimatedPlayPause = memo(function AnimatedPlayPause({
  isPlaying,
  isLoading,
  direction = 1,
  color,
  size = 32,
  containerSize = 68,
}: {
  isPlaying: boolean;
  isLoading: boolean;
  /** Seek direction the loader reflects: 1 forward, -1 backward. */
  direction?: MotionDirection;
  color: string;
  size?: number;
  containerSize?: number;
}) {
  const iconStyle = useMemo(
    () => ({ width: (animation.w / 156) * size, height: (animation.h / 156) * size }),
    [size],
  );
  const containerStyle = useMemo(
    () => ({
      width: containerSize,
      height: containerSize,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    }),
    [containerSize],
  );
  const target: MotionTarget = isLoading ? "loading" : isPlaying ? "pause" : "play";
  const desired = useSharedValue(target);
  const desiredDirection = useSharedValue(direction);
  const motion = useSharedValue(createMotion(target));
  const progress = useSharedValue(isPlaying ? 18 / animation.op : 0);
  // Horizontal flip reverses the apparent rotation. The spinner is exactly
  // mirror-symmetric and pause within 0.2/320, so only clips that touch the
  // play triangle stay unmirrored; the sampler decides per clip.
  const mirror = useSharedValue(false);
  const reducedMotion = useReducedMotion();
  const colorFilters = useMemo(
    () => animation.layers.map((layer) => ({ keypath: layer.nm, color })),
    [color],
  );
  useEffect(() => {
    desired.value = target;
  }, [target, desired]);
  useEffect(() => {
    desiredDirection.value = direction;
  }, [direction, desiredDirection]);
  // Only progress reaches the native view per frame: no React render or JSON.stringify.
  useFrameCallback(({ timestamp }) => {
    const current = motion.value;
    if (
      !current.transition &&
      current.state === desired.value &&
      current.desiredDirection === desiredDirection.value &&
      (desired.value !== "loading" || reducedMotion)
    )
      return;
    const state = { ...current, target: desired.value, desiredDirection: desiredDirection.value };
    const sample = sampleMotion(state, timestamp, reducedMotion);
    motion.value = state;
    progress.value = sample.seconds * frameRatio;
    mirror.value = sample.mirror;
  });
  const animatedProps = useAnimatedProps(() => ({ progress: progress.value }));
  const mirrorStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: mirror.value ? -1 : 1 }],
  }));
  const lottieStyle = useMemo(() => [iconStyle, mirrorStyle], [iconStyle, mirrorStyle]);
  // Flatten both overlapping contours before the native button applies pressed opacity.
  // Core Animation redraws this surface as progress changes; the motion stays on the UI thread.
  return (
    <View
      pointerEvents="none"
      accessible={false}
      collapsable={false}
      shouldRasterizeIOS
      style={containerStyle}
    >
      <AnimatedLottieView
        source={animation}
        loop={false}
        autoPlay={false}
        animatedProps={animatedProps}
        colorFilters={colorFilters}
        style={lottieStyle}
      />
    </View>
  );
});
