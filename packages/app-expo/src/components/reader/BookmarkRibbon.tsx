import { BookmarkIcon } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";

interface BookmarkRibbonProps {
  visible: boolean;
  topOffset?: number;
  rightOffset?: number;
}

/**
 * A bookmark ribbon shown at the top-right of the reader page
 * when the current position is bookmarked.
 */
export function BookmarkRibbon({ visible, topOffset = 0, rightOffset = 20 }: BookmarkRibbonProps) {
  const colors = useColors();
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
  }, [visible, anim]);

  const opacity = anim;
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-20, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        { top: topOffset, right: rightOffset, opacity, transform: [{ translateY }] },
      ]}
    >
      <BookmarkIcon size={24} color={colors.primary} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    zIndex: 10,
  },
});
