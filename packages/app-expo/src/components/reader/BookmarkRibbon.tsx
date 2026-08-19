import { BookmarkIcon } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import { StyleSheet } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

interface BookmarkRibbonProps {
  visible: boolean;
  topOffset?: number;
  rightOffset?: number;
}

/** Сильный ease-out: появление должно начинаться сразу, без вялого разгона. */
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

/** Появление и исчезновение — верхняя граница диапазона мелких изменений. */
const DURATION_MS = 200;

/** Лента приезжает сверху, из-за края страницы. */
const HIDDEN_OFFSET = -20;

/**
 * Лента закладки в правом верхнем углу страницы ридера: показывается, когда
 * текущая позиция отмечена.
 *
 * Появление без пружины намеренно: пальца здесь нет, отбрасывать нечего, а
 * перелёт на элементе, который просто проявился, читается как дребезг.
 */
export function BookmarkRibbon({ visible, topOffset = 0, rightOffset = 20 }: BookmarkRibbonProps) {
  const colors = useColors();
  // Уменьшенное движение — это «меньше и мягче», а не «ничего»: сдвиг убираем,
  // проявление оставляем, иначе пропадает объяснение смены состояния.
  const reducedMotion = useReducedMotion();

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        {
          top: topOffset,
          right: rightOffset,
          opacity: visible ? 1 : 0,
          transform: [{ translateY: reducedMotion || visible ? 0 : HIDDEN_OFFSET }],
          transitionProperty: reducedMotion ? "opacity" : ["opacity", "transform"],
          transitionDuration: DURATION_MS,
          transitionTimingFunction: EASE_OUT,
        },
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
