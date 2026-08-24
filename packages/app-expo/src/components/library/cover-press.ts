/**
 * Отклик обложки на нажатие — один на библиотеку, каталог и полку «Читаю
 * сейчас», иначе они разъезжаются.
 *
 * Обложку трогают десятки раз за сессию, поэтому движение держим на пороге
 * заметности: 3% и 120 мс. Это CSS-переход Reanimated, а не shared value —
 * состояние меняется дважды за нажатие, а не каждый кадр, и заводить ради
 * этого воркет незачем. Типы StyleSheet.create таких свойств не знают, поэтому
 * стили живут здесь обычными объектами и уходят прямо в style у Animated.View.
 *
 * Кривая задаётся через cubicBezier(): CSS-строку "cubic-bezier(...)"
 * Reanimated не принимает и падает на рендере.
 */
import { cubicBezier } from "react-native-reanimated";

export const coverPress = {
  transform: [{ scale: 1 }],
  transitionProperty: "transform",
  transitionDuration: "120ms",
  transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
} as const;

export const coverPressed = { transform: [{ scale: 0.97 }] } as const;
