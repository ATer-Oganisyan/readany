/**
 * Отклик обложки на нажатие — один на библиотеку, каталог и полку «Читаю
 * сейчас», иначе они разъезжаются.
 *
 * Это CSS-переход Reanimated, а не shared value: состояние меняется дважды за
 * нажатие, а не каждый кадр, и заводить ради этого воркет незачем. Типы
 * StyleSheet.create таких свойств не знают, поэтому стили живут здесь
 * обычными объектами и уходят прямо в style у Animated.View.
 *
 * Кривая — easeOutCubic, а не easeOutQuint: у последней больше половины хода
 * приходится на первый кадр, и на трёх точках движения это читается как рывок,
 * а не как анимация. Строку "cubic-bezier(...)" Reanimated не принимает и
 * падает на рендере, поэтому кривая задаётся функцией.
 */
import { cubicBezier } from "react-native-reanimated";

export const coverPress = {
  transform: [{ scale: 1 }],
  transitionProperty: "transform",
  transitionDuration: "150ms",
  transitionTimingFunction: cubicBezier(0.33, 1, 0.68, 1),
} as const;

export const coverPressed = { transform: [{ scale: 0.97 }] } as const;
