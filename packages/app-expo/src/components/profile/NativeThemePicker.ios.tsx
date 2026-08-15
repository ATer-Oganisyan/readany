import { spacing, useTheme } from "@/styles/theme";
import { baseColors, spacingPixels } from "@deslop/primitives";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { Host, Picker, Text } from "@expo/ui/swift-ui";
import { controlSize, frame, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { useCallback, useEffect, useRef } from "react";
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  ScrollView as NativeScrollView,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { NativeThemePickerProps } from "./NativeThemePicker.types";

type SegmentLayout = { x: number; width: number };
const SEGMENT_CONTROL_HEIGHT = spacingPixels[44];
const CHIP_ANIMATION_DURATION_MS = 80;
const CHIP_PRESSED_SCALE = 0.9;
const CHIP_ANIMATION = {
  duration: CHIP_ANIMATION_DURATION_MS,
  easing: Easing.inOut(Easing.quad),
} as const;
const whiteToken = baseColors.find(({ name }) => name === "White");
if (!whiteToken) {
  throw new Error('@deslop/primitives: color token "White" is missing');
}
const CHIP_ACTIVE_FOREGROUND_COLOR = whiteToken.light;

interface ChipProps {
  label: string;
  selected: boolean;
  activeBackgroundColor: string;
  activeForegroundColor: string;
  inactiveBackgroundColor: string;
  inactiveForegroundColor: string;
  onPress: () => void;
}

function Chip({
  label,
  selected,
  activeBackgroundColor,
  activeForegroundColor,
  inactiveBackgroundColor,
  inactiveForegroundColor,
  onPress,
}: ChipProps) {
  const pressed = useSharedValue(0);
  const selectedProgress = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    selectedProgress.value = withTiming(selected ? 1 : 0, CHIP_ANIMATION);
  }, [selected, selectedProgress]);

  const chipStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      selectedProgress.value,
      [0, 1],
      [inactiveBackgroundColor, activeBackgroundColor],
    ),
    transform: [{ scale: 1 - pressed.value * (1 - CHIP_PRESSED_SCALE) }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      selectedProgress.value,
      [0, 1],
      [inactiveForegroundColor, activeForegroundColor],
    ),
  }));

  const setPressed = (nextPressed: boolean) => {
    pressed.value = withTiming(nextPressed ? 1 : 0, CHIP_ANIMATION);
  };

  return (
    <Pressable
      accessible
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={4}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
    >
      <Animated.View style={[styles.chip, chipStyle]}>
        <Animated.Text numberOfLines={1} style={[styles.chipLabel, labelStyle]}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

export function NativeThemePicker({
  values,
  selectedIndex,
  onSelect,
  colorScheme,
  accessibilityLabel,
  scrollable = false,
}: NativeThemePickerProps) {
  const { colors } = useTheme();
  const scrollRef = useRef<NativeScrollView>(null);
  const segmentLayoutsRef = useRef(new Map<number, SegmentLayout>());
  const viewportWidthRef = useRef(0);
  const scrollOffsetRef = useRef(0);

  const scrollToSegment = useCallback((index: number) => {
    const layout = segmentLayoutsRef.current.get(index);
    const viewportWidth = viewportWidthRef.current;
    if (!layout || viewportWidth <= 0) return;

    const edgeInset = spacing.lg;
    const visibleLeft = scrollOffsetRef.current + edgeInset;
    const visibleRight = scrollOffsetRef.current + viewportWidth - edgeInset;
    const segmentRight = layout.x + layout.width;
    let nextOffset = scrollOffsetRef.current;

    if (layout.x < visibleLeft) {
      nextOffset = Math.max(0, layout.x - edgeInset);
    } else if (segmentRight > visibleRight) {
      nextOffset = Math.max(0, segmentRight - viewportWidth + edgeInset);
    } else {
      return;
    }

    scrollOffsetRef.current = nextOffset;
    scrollRef.current?.scrollTo({ x: nextOffset, animated: true });
  }, []);

  useEffect(() => {
    if (!scrollable) return;
    const frame = requestAnimationFrame(() => scrollToSegment(selectedIndex));
    return () => cancelAnimationFrame(frame);
  }, [scrollToSegment, scrollable, selectedIndex]);

  const picker = (
    <Picker
      label={accessibilityLabel}
      selection={selectedIndex}
      onSelectionChange={onSelect}
      modifiers={[
        pickerStyle("segmented"),
        controlSize("large"),
        frame({ maxWidth: 10_000, height: SEGMENT_CONTROL_HEIGHT }),
      ]}
    >
      {values.map((label, index) => (
        <Text key={label} modifiers={[tag(index)]}>
          {label}
        </Text>
      ))}
    </Picker>
  );

  if (scrollable) {
    const handleViewportLayout = (event: LayoutChangeEvent) => {
      viewportWidthRef.current = event.nativeEvent.layout.width;
      scrollToSegment(selectedIndex);
    };
    const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollOffsetRef.current = event.nativeEvent.contentOffset.x;
    };

    return (
      <NativeScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={handleViewportLayout}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContent}
      >
        {values.map((label, index) => (
          <View
            key={`${index}-${label}`}
            onLayout={(event) => {
              const { x, width } = event.nativeEvent.layout;
              segmentLayoutsRef.current.set(index, { x, width });
              if (index === selectedIndex) scrollToSegment(index);
            }}
          >
            <Chip
              label={label}
              selected={selectedIndex === index}
              activeBackgroundColor={colors.primary}
              activeForegroundColor={CHIP_ACTIVE_FOREGROUND_COLOR}
              inactiveBackgroundColor={colors.primary5}
              inactiveForegroundColor={colors.mutedForeground}
              onPress={() => {
                scrollToSegment(index);
                onSelect(index);
              }}
            />
          </View>
        ))}
      </NativeScrollView>
    );
  }

  return (
    <Host style={styles.host} colorScheme={colorScheme}>
      {picker}
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: "100%", height: SEGMENT_CONTROL_HEIGHT },
  chip: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 999,
    justifyContent: "center",
    height: SEGMENT_CONTROL_HEIGHT,
    paddingHorizontal: spacing.lg,
  },
  chipLabel: { fontFamily: interfaceFontFamily.semibold, fontSize: 17, lineHeight: 22 },
  scrollContent: {
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
});
