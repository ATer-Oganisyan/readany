import ReadAnyNativeControls from "../../modules/native-controls";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

/** The same cover-derived palette for book details and the audiobook sheet. */
export function useCoverSheetColors(artwork: string | undefined) {
  const [coverColor, setCoverColor] = useState<{ uri: string; color: string; accent: string }>();
  useEffect(() => {
    if (Platform.OS !== "ios" || !artwork || !ReadAnyNativeControls.averageTopImageColor) {
      return;
    }
    let cancelled = false;
    void ReadAnyNativeControls.averageTopImageColor(artwork, 0.25)
      .then((color) => {
        if (cancelled || !/^#[0-9a-f]{6}$/i.test(color)) return;
        // Mix in 35% black for a deeper background that preserves the cover hue.
        const darker = `#${[1, 3, 5]
          .map((offset) =>
            Math.round(Number.parseInt(color.slice(offset, offset + 2), 16) * 0.65)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`;
        // Screen with 60% white over the sheet background, precomputed for native tint.
        const accent = `#${[1, 3, 5]
          .map((offset) =>
            Math.round(Number.parseInt(darker.slice(offset, offset + 2), 16) * 0.4 + 255 * 0.6)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`;
        setCoverColor({ uri: artwork, color: darker, accent });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [artwork]);
  return coverColor?.uri === artwork ? coverColor : undefined;
}
