import { useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { COVER_PRESS_FEEDBACK } from "./cover-press-config";

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
const PRESSED_SCALE = COVER_PRESS_FEEDBACK.scale;
const PRESS_DURATION_MS = COVER_PRESS_FEEDBACK.durationMs;
const EASE_OUT = Easing.bezier(...COVER_PRESS_FEEDBACK.easing);

export function useCoverPress(disabled = false) {
  const progress = useSharedValue(0);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - progress.get() * (1 - PRESSED_SCALE) }],
  }));

  // Pressability delivers press-in/out through JS. Navigation or EPUB
  // preparation can delay that thread and leave the card compressed after the
  // finger is already up. This observer owns only the visual state and runs on
  // the UI thread; Pressable remains the sole owner of the action and a11y.
  const gesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(!disabled)
        .maxDistance(16)
        .maxDuration(60_000)
        .cancelsTouchesInView(false)
        .runOnJS(false)
        .onBegin(() => {
          "worklet";
          cancelAnimation(progress);
          progress.set(withTiming(1, { duration: PRESS_DURATION_MS, easing: EASE_OUT }));
        })
        .onFinalize(() => {
          "worklet";
          cancelAnimation(progress);
          progress.set(withTiming(0, { duration: PRESS_DURATION_MS, easing: EASE_OUT }));
        }),
    [disabled, progress],
  );

  // Kept for cards that participate in the existing long-press action sheet.
  // PerspectiveBook uses the UI-thread gesture above.
  const onPressIn = () => {
    cancelAnimation(progress);
    progress.set(withTiming(1, { duration: PRESS_DURATION_MS, easing: EASE_OUT }));
  };
  const release = () => {
    cancelAnimation(progress);
    progress.set(withTiming(0, { duration: PRESS_DURATION_MS, easing: EASE_OUT }));
  };

  return { pressStyle, gesture, onPressIn, onPressOut: release, release };
}
