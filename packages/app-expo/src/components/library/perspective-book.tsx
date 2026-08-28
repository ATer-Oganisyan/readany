import { countRender } from "@/lib/diagnostics/interaction-performance";
import { radius } from "@/styles/theme";
import { LinearGradient } from "expo-linear-gradient";
import { type ReactNode, memo, useMemo } from "react";
import { type GestureResponderEvent, Pressable, StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useCoverPress } from "./cover-press";

interface PerspectiveBookProps {
  width: number;
  height: number;
  cover: ReactNode;
  coverEffects?: boolean;
  showShadow?: boolean;
  footer?: ReactNode;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
}

export const PerspectiveBook = memo(function PerspectiveBook({
  width,
  height,
  cover,
  coverEffects = true,
  showShadow = true,
  footer,
  onPress,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
}: PerspectiveBookProps) {
  countRender("catalog.perspective");
  const { pressStyle, gesture } = useCoverPress(disabled);
  const size = useMemo(() => ({ width, height }), [width, height]);
  const pressableSize = useMemo(() => ({ width }), [width]);

  return (
    <GestureDetector gesture={gesture}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        disabled={disabled}
        onPress={onPress}
        // Небольшой сдвиг пальца не должен отменять нажатие.
        pressRetentionOffset={16}
        style={[pressableSize, disabled && styles.disabled]}
      >
        <Animated.View style={[pressStyle, styles.book, showShadow && styles.bookShadow, size]}>
          <View style={[styles.cover, !coverEffects && styles.coverWithoutEffects, size]}>
            {cover}
            {coverEffects ? <BookSurfaceEffects /> : null}
          </View>
        </Animated.View>
        {footer}
      </Pressable>
    </GestureDetector>
  );
});

const SPINE_HIGHLIGHT_COLORS = [
  "rgba(255,255,255,0)",
  "rgba(255,255,255,0)",
  "rgba(255,255,255,0.25)",
  "rgba(255,255,255,0)",
  "rgba(255,255,255,0)",
  "rgba(255,255,255,0.22)",
  "rgba(255,255,255,0)",
] as const;
const SPINE_HIGHLIGHT_LOCATIONS = [0, 0.12, 0.2925, 0.505, 0.7525, 0.91, 1] as const;
const SPINE_SHADE_COLORS = [
  "rgba(0,0,0,0.03)",
  "rgba(0,0,0,0.10)",
  "rgba(0,0,0,0)",
  "rgba(0,0,0,0.02)",
  "rgba(0,0,0,0.20)",
  "rgba(0,0,0,0.50)",
  "rgba(0,0,0,0.15)",
  "rgba(0,0,0,0)",
] as const;
const SPINE_SHADE_LOCATIONS = [0, 0.12, 0.3, 0.5, 0.735, 0.7525, 0.8525, 1] as const;
const COVER_SHADE_COLORS = [
  "rgba(255,255,255,0.13)",
  "rgba(255,255,255,0)",
  "rgba(0,0,0,0.18)",
] as const;
const COVER_SHADE_LOCATIONS = [0, 0.52, 1] as const;
const HORIZONTAL_START = { x: 0, y: 0 };
const HORIZONTAL_END = { x: 1, y: 0 };

// This surface is identical on every card. Stable props and a separate memo
// boundary keep cover/status updates from resubmitting all gradient stops.
const BookSurfaceEffects = memo(function BookSurfaceEffects() {
  return (
    <>
      <LinearGradient
        colors={SPINE_HIGHLIGHT_COLORS}
        locations={SPINE_HIGHLIGHT_LOCATIONS}
        start={HORIZONTAL_START}
        end={HORIZONTAL_END}
        pointerEvents="none"
        style={styles.spine}
      />
      <LinearGradient
        colors={SPINE_SHADE_COLORS}
        locations={SPINE_SHADE_LOCATIONS}
        start={HORIZONTAL_START}
        end={HORIZONTAL_END}
        pointerEvents="none"
        style={styles.spine}
      />
      <LinearGradient
        colors={COVER_SHADE_COLORS}
        locations={COVER_SHADE_LOCATIONS}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.coverFinish} />
    </>
  );
});

const styles = StyleSheet.create({
  book: {
    position: "relative",
    borderRadius: radius.sm,
    borderCurve: "continuous",
  },
  bookShadow: { boxShadow: "0 2px 4px rgba(0,0,0,0.20), 0 11px 22px rgba(0,0,0,0.22)" },
  cover: {
    overflow: "hidden",
    position: "relative",
    borderRadius: radius.sm,
    borderCurve: "continuous",
    backgroundColor: "#1f1f1f",
  },
  coverWithoutEffects: {
    backgroundColor: "transparent",
  },
  spine: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: "9%",
    opacity: 0.72,
  },
  coverFinish: {
    ...StyleSheet.absoluteFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.11)",
    borderRadius: radius.sm,
    borderCurve: "continuous",
    boxShadow:
      "inset 0 -1px rgba(0,0,0,0.18), inset 0 2px 2px rgba(255,255,255,0.10), inset 4px 0 4px rgba(0,0,0,0.13)",
  },
  disabled: { opacity: 0.7 },
});
