import { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/**
 * Отклик обложки на нажатие — один на библиотеку, каталог и полку «Читаю
 * сейчас», иначе они разъезжаются.
 *
 * Раньше это был CSS-переход Reanimated, и он не отрисовывался: значение
 * применялось одним кадром, хотя JS-сторона переход исправно запускала. Здесь
 * движение ведёт shared value, поэтому оно живёт целиком в UI-потоке и не
 * зависит ни от коммита React, ни от того, обёрнута ли карточка в SwiftUI-хост
 * контекстного меню.
 *
 * 3% и 150 мс: обложку трогают десятки раз за сессию, поэтому отклик держим
 * коротким. Кривая — easeOutCubic; у easeOutQuint половина хода приходится на
 * первый кадр, и на трёх точках движения это читается как рывок.
 */
const PRESSED_SCALE = 0.97;
const PRESS_DURATION_MS = 150;
const EASE_OUT = Easing.bezier(0.33, 1, 0.68, 1);

export function useCoverPress() {
  const progress = useSharedValue(0);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - progress.get() * (1 - PRESSED_SCALE) }],
  }));

  const onPressIn = () => {
    progress.set(withTiming(1, { duration: PRESS_DURATION_MS, easing: EASE_OUT }));
  };

  const onPressOut = () => {
    progress.set(withTiming(0, { duration: PRESS_DURATION_MS, easing: EASE_OUT }));
  };

  return { pressStyle, onPressIn, onPressOut };
}
