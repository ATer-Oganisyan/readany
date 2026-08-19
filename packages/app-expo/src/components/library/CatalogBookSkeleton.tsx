import { radius, useColors } from "@/styles/theme";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const PULSE_HALF_CYCLE_MS = 700;
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

/**
 * Одни общие часы пульсации на все заглушки.
 *
 * Если бы каждая заглушка запускала свою анимацию, фаза зависела бы от момента
 * монтирования: книги догружаются вразнобой, и мерцание расходилось бы. Общее
 * значение читают все скелетоны сразу, поэтому они пульсируют синхронно
 * независимо от того, когда появились.
 */
const pulse = makeMutable(0);
let pulseStarted = false;

function startPulseOnce() {
  if (pulseStarted) return;
  pulseStarted = true;
  pulse.set(
    withRepeat(withTiming(1, { duration: PULSE_HALF_CYCLE_MS, easing: EASE_IN_OUT }), -1, true),
  );
}

/**
 * Заглушка книги каталога: занимает место карточки, пока не готова обложка.
 *
 * Анимируется только opacity слоя Primary 10 поверх подложки Primary 5 — без
 * пересчёта раскладки и без работы на JS-потоке.
 *
 * При включённом «уменьшить движение» пульсации нет: заглушка остаётся ровной
 * подложкой, она и без анимации сообщает, что место занято.
 */
export function CatalogBookSkeleton({ cardWidth }: { cardWidth: number }) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const height = cardWidth * (41 / 28);

  useEffect(() => {
    if (!reduced) startPulseOnce();
  }, [reduced]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.base, { width: cardWidth, height, backgroundColor: colors.primary5 }]}
    >
      {reduced ? null : (
        <Animated.View style={[styles.pulse, { backgroundColor: colors.primary10 }, pulseStyle]} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: "hidden",
    borderRadius: radius.sm,
    borderCurve: "continuous",
  },
  pulse: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
});
