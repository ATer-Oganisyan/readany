import { CharacterPortraitImage } from "@/components/narra/character-portrait-image";
import { resolveCharacterPortraitUri } from "@/lib/narra/character-portrait";
import type { NarraCharacter } from "@/lib/narra/types";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Image, type ImageStyle, type StyleProp, StyleSheet } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

/**
 * Портрет персонажа с двумя состояниями перегенерации:
 *
 * - пока ждём новую картинку, на экране остаётся текущая и «дышит» (шиммер):
 *   секунда вниз до 70% непрозрачности, секунда обратно до 100%, ease-in-out;
 * - когда новая картинка готова, подмена идёт последовательно: старая гаснет
 *   за 500 мс, только потом новая проявляется за 500 мс, тоже ease-in-out.
 *
 * Ни затемнения, ни спиннера поверх портрета здесь нет намеренно — ожидание
 * показывает сам шиммер.
 */

const SHIMMER_MIN_OPACITY = 0.7;
const SHIMMER_LEG_MS = 1000;
const FADE_MS = 500;
const EASE_IN_OUT = Easing.inOut(Easing.ease);

type PortraitCharacter = Parameters<typeof CharacterPortraitImage>[0]["character"] &
  Pick<NarraCharacter, "portraitAssetId" | "portraitUri" | "portraitUriOverridesAsset">;

interface AnimatedCharacterPortraitProps {
  character: PortraitCharacter;
  fallback: ReactNode;
  /** Идёт генерация: текущая картинка остаётся на месте и шиммерит. */
  busy?: boolean;
  onUnavailable?: () => void;
  staticOnly?: boolean;
  style?: StyleProp<ImageStyle>;
}

/** Ключ картинки: по его смене понимаем, что пора менять портрет. */
function portraitKey(character: PortraitCharacter): string {
  return `${character.portraitAssetId ?? ""}|${character.portraitUri ?? ""}|${
    character.portraitUriOverridesAsset ? "override" : "default"
  }`;
}

export function AnimatedCharacterPortrait({
  character,
  fallback,
  busy = false,
  onUnavailable,
  staticOnly,
  style,
}: AnimatedCharacterPortraitProps) {
  // Что реально нарисовано: отстаёт от `character` на время затухания старой картинки.
  const [shown, setShown] = useState(character);
  const fade = useSharedValue(1);
  const shimmer = useSharedValue(1);
  const incomingKey = portraitKey(character);
  const shownKey = portraitKey(shown);
  const characterRef = useRef(character);
  characterRef.current = character;

  const fadeInNext = useCallback(() => {
    setShown(characterRef.current);
    fade.value = withTiming(1, { duration: FADE_MS, easing: EASE_IN_OUT });
  }, [fade]);

  // Шиммер живёт только во время ожидания и не мешает подмене: как только
  // пришла новая картинка, эффект ниже его останавливает.
  useEffect(() => {
    if (!busy || incomingKey !== shownKey) return;
    shimmer.value = withRepeat(
      withSequence(
        withTiming(SHIMMER_MIN_OPACITY, { duration: SHIMMER_LEG_MS, easing: EASE_IN_OUT }),
        withTiming(1, { duration: SHIMMER_LEG_MS, easing: EASE_IN_OUT }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(shimmer);
      shimmer.value = withTiming(1, { duration: 200, easing: EASE_IN_OUT });
    };
  }, [busy, incomingKey, shownKey, shimmer]);

  useEffect(() => {
    if (incomingKey === shownKey) return;
    let cancelled = false;

    // Греем картинку до начала анимации: иначе после ухода старой новая
    // проявлялась бы из пустоты, пока её декодируют.
    const uri = resolveCharacterPortraitUri(character);
    const warmed = uri ? Image.prefetch(uri).catch(() => undefined) : Promise.resolve(undefined);

    void warmed.then(() => {
      if (cancelled) return;
      cancelAnimation(shimmer);
      shimmer.value = 1;
      fade.value = withTiming(0, { duration: FADE_MS, easing: EASE_IN_OUT }, (finished) => {
        if (finished) runOnJS(fadeInNext)();
      });
    });

    return () => {
      cancelled = true;
    };
  }, [character, incomingKey, shownKey, fade, shimmer, fadeInNext]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: fade.value * shimmer.value,
  }));

  // Пока картинка та же, остальные поля (например, подъехавшая idle-анимация)
  // должны доходить до портрета сразу; `shown` отстаёт только во время подмены.
  const rendered = incomingKey === shownKey ? character : shown;

  return (
    <Animated.View style={[style, animatedStyle]}>
      <CharacterPortraitImage
        character={rendered}
        fallback={fallback}
        onUnavailable={onUnavailable}
        staticOnly={staticOnly}
        style={styles.image}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  image: { width: "100%", height: "100%" },
});
