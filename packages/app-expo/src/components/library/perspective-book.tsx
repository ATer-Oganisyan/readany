import { radius } from "@/styles/theme";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useCoverPress } from "./cover-press";

interface PerspectiveBookProps {
  width: number;
  height: number;
  cover: ReactNode;
  coverEffects?: boolean;
  footer?: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
}

export function PerspectiveBook({
  width,
  height,
  cover,
  coverEffects = true,
  footer,
  onPress,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
}: PerspectiveBookProps) {
  const { pressStyle, gesture } = useCoverPress(disabled);

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
        style={[{ width }, disabled && styles.disabled]}
      >
        <Animated.View style={[pressStyle, styles.book, { width, height }]}>
          <View
            style={[styles.cover, !coverEffects && styles.coverWithoutEffects, { width, height }]}
          >
            {cover}

            {coverEffects ? (
              <>
                <LinearGradient
                  colors={[
                    "rgba(255,255,255,0)",
                    "rgba(255,255,255,0)",
                    "rgba(255,255,255,0.25)",
                    "rgba(255,255,255,0)",
                    "rgba(255,255,255,0)",
                    "rgba(255,255,255,0.22)",
                    "rgba(255,255,255,0)",
                  ]}
                  locations={[0, 0.12, 0.2925, 0.505, 0.7525, 0.91, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  pointerEvents="none"
                  style={styles.spine}
                />
                <LinearGradient
                  colors={[
                    "rgba(0,0,0,0.03)",
                    "rgba(0,0,0,0.10)",
                    "rgba(0,0,0,0)",
                    "rgba(0,0,0,0.02)",
                    "rgba(0,0,0,0.20)",
                    "rgba(0,0,0,0.50)",
                    "rgba(0,0,0,0.15)",
                    "rgba(0,0,0,0)",
                  ]}
                  locations={[0, 0.12, 0.3, 0.5, 0.735, 0.7525, 0.8525, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  pointerEvents="none"
                  style={styles.spine}
                />
                <LinearGradient
                  colors={["rgba(255,255,255,0.13)", "rgba(255,255,255,0)", "rgba(0,0,0,0.18)"]}
                  locations={[0, 0.52, 1]}
                  pointerEvents="none"
                  style={StyleSheet.absoluteFill}
                />
                <View pointerEvents="none" style={styles.coverFinish} />
              </>
            ) : null}
          </View>
        </Animated.View>
        {footer}
      </Pressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  book: {
    position: "relative",
    borderRadius: radius.sm,
    borderCurve: "continuous",
    boxShadow: "0 2px 4px rgba(0,0,0,0.20), 0 11px 22px rgba(0,0,0,0.22)",
  },
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
