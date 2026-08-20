/**
 * Цвет текста поверх фона, который заранее неизвестен.
 *
 * Имя героя на плашке портрета и типографика обложки решают одну задачу:
 * остаться читаемыми на картинке, цвет которой мы не выбирали. Решает яркость
 * фона, а не режим темы — на чёрной обложке текст светлый и в светлой теме.
 */

export interface ForegroundOnBackground {
  /** Фон тёмный — значит текст светлый. */
  isDark: boolean;
  primary: string;
  secondary: string;
}

/** Выше этой яркости фон считается светлым. Подобрано на портретах героев. */
const LIGHT_BACKGROUND_LUMINANCE = 0.58;

const FOREGROUND_ON_LIGHT: ForegroundOnBackground = {
  isDark: false,
  primary: "rgba(0,0,0,0.9)",
  secondary: "rgba(0,0,0,0.62)",
};

const FOREGROUND_ON_DARK: ForegroundOnBackground = {
  isDark: true,
  primary: "rgba(255,255,255,0.96)",
  secondary: "rgba(255,255,255,0.72)",
};

export function foregroundForBackground(color: string): ForegroundOnBackground {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

  return luminance > LIGHT_BACKGROUND_LUMINANCE ? FOREGROUND_ON_LIGHT : FOREGROUND_ON_DARK;
}

/** Пара для фона, про который известно только «тёмный» или «светлый». */
export function foregroundForKnownTone(tone: "dark" | "light"): ForegroundOnBackground {
  return tone === "light" ? FOREGROUND_ON_DARK : FOREGROUND_ON_LIGHT;
}
