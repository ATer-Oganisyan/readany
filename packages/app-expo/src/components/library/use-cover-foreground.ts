import type { CoverTextTone } from "@/lib/book/cover-text-contrast";
import {
  type ForegroundOnBackground,
  foregroundForBackground,
  foregroundForKnownTone,
} from "@/styles/foreground-for-background";
import { useEffect, useState } from "react";
import ReadAnyNativeControls from "../../../modules/native-controls";

/**
 * Цвет типографики обложки по самой обложке.
 *
 * Раньше тон брался из хеша «название:автор»: он совпадал с фоном, который мы
 * заказывали генератору, и к обложкам из бэкенда отношения не имел — отсюда
 * серый текст на чёрной картинке. Здесь цвет считается по средней яркости
 * файла, поэтому работает на любой обложке независимо от её происхождения.
 */

const coverBackgroundCache = new Map<string, string>();
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function useCoverForeground(
  coverUri: string | undefined,
  fallbackTone: CoverTextTone,
): ForegroundOnBackground {
  const cachedColor = coverUri ? coverBackgroundCache.get(coverUri) : undefined;
  const [measuredColor, setMeasuredColor] = useState(cachedColor);

  useEffect(() => {
    if (!coverUri) {
      setMeasuredColor(undefined);
      return;
    }
    const cached = coverBackgroundCache.get(coverUri);
    // Карточки переиспользуются списком. Не оставляем на новой обложке цвет,
    // измеренный для предыдущей, пока нативный замер ещё выполняется.
    setMeasuredColor(cached);
    if (cached) {
      return;
    }

    let cancelled = false;
    // Меряем всю обложку: фон у неё сплошной от края до края, поэтому средний
    // цвет файла и есть цвет под текстом.
    void ReadAnyNativeControls.averageBottomImageColor(coverUri, 1)
      .then((color) => {
        if (cancelled || !HEX_COLOR.test(color)) return;
        coverBackgroundCache.set(coverUri, color);
        setMeasuredColor(color);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [coverUri]);

  // Пока замер не пришёл, держим прежний тон: он верен для наших обложек и не
  // даёт тексту мигнуть цветом на уже открытом экране.
  return measuredColor
    ? foregroundForBackground(measuredColor)
    : foregroundForKnownTone(fallbackTone);
}
