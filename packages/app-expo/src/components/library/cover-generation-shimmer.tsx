import { useTheme, withOpacity } from "@/styles/theme";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const PHASE_DURATION_MS = 1_000;

export function CoverGenerationShimmer() {
  const { colors } = useTheme();
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: PHASE_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(0, {
          duration: PHASE_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
        }),
      ),
      -1,
      false,
    );

    return () => cancelAnimation(opacity);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.overlay,
        { backgroundColor: withOpacity(colors.foreground, 0.18) },
        animatedStyle,
      ]}
      testID="cover-generation-shimmer"
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
  },
});
