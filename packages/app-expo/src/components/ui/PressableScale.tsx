/**
 * PressableScale — базовая реакция на касание для всего приложения.
 *
 * Почему вжатие, а не затухание прозрачности: `activeOpacity` — это перенос
 * веб-приёма, где отклик жил в наведении курсора. На телефоне палец уже лежит
 * на элементе, и затухание читается как «экран моргнул». Масштаб уводит за
 * собой подпись и иконку внутри, и именно это делает нажатие физическим.
 *
 * Отклик появляется на нажатии, а действие срабатывает на отпускании: ждать
 * завершения тапа, чтобы что-то показать, — это ровно та задержка, которую
 * пользователь замечает.
 *
 * Масштаб живёт на CSS-переходе Reanimated, а не на разделяемом значении:
 * состояний всего два и палец ничего не тянет непрерывно, поэтому воркет здесь
 * был бы избыточен.
 */
import { useMemo } from "react";
import type { PressableProps, StyleProp, ViewStyle } from "react-native";
import { Pressable } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

/** Сильный ease-out: движение начинается сразу, встроенные кривые слишком вялые. */
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

/** Ниже порога вжатие перестаёт читаться, выше — начинает выглядеть как игрушка. */
const PRESSED_SCALE = 0.97;

/** Нижняя граница диапазона отклика на нажатие. */
const DURATION_MS = 120;

/** Минимальная зона касания: 44pt на iOS, 48dp на Android. Берём больший. */
const MIN_TOUCH_TARGET = 48;

/** Допуск на дрожание пальца, чтобы сдвиг на пару точек не отменял нажатие. */
const DEFAULT_RETENTION_OFFSET = 12;

export interface PressableScaleProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  /**
   * Глубина вжатия. Уменьшайте для крупных поверхностей — карточка во весь
   * экран на 0.97 выглядит так, будто уезжает вдаль.
   */
  pressedScale?: number;
  /**
   * Отключает вжатие, оставляя обычное нажатие. Для случаев, где элемент уже
   * анимируется чем-то другим и два движения конфликтуют.
   */
  disableScale?: boolean;
}

export function PressableScale({
  style,
  pressedScale = PRESSED_SCALE,
  disableScale = false,
  hitSlop,
  pressRetentionOffset,
  children,
  ...pressableProps
}: PressableScaleProps) {
  // Уменьшенное движение означает «меньше и мягче», а не «ничего»: вжатие
  // убираем, само нажатие и всё, что оно вызывает, остаётся на месте.
  const reducedMotion = useReducedMotion();
  const animates = !disableScale && !reducedMotion;

  const transitionStyle = useMemo(
    () =>
      animates
        ? {
            transitionProperty: "transform" as const,
            transitionDuration: DURATION_MS,
            transitionTimingFunction: EASE_OUT,
          }
        : null,
    [animates],
  );

  return (
    <Pressable
      hitSlop={hitSlop ?? { top: 8, bottom: 8, left: 8, right: 8 }}
      pressRetentionOffset={pressRetentionOffset ?? DEFAULT_RETENTION_OFFSET}
      {...pressableProps}
    >
      {(state) => (
        <Animated.View
          style={[
            transitionStyle,
            animates ? { transform: [{ scale: state.pressed ? pressedScale : 1 }] } : null,
            style,
          ]}
        >
          {typeof children === "function" ? children(state) : children}
        </Animated.View>
      )}
    </Pressable>
  );
}

export { MIN_TOUCH_TARGET };
