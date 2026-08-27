/**
 * Темы страницы читалки — пресеты фона и текста в стиле Apple Books
 * (образец — панель «Темы и настройки» narra).
 *
 * Light, Dark, Sepia задают цвета всей поверхности ридера и WebView.
 * Сохранённый id "original" оставлен для совместимости и означает Light.
 */

export type ReaderPageTheme = "original" | "sepia" | "dark";

export interface ReaderThemeColors {
  background: string;
  foreground: string;
  muted: string;
  primary: string;
}

export interface ReaderThemeTokenPalette {
  /** Адаптивный токен Primary 10 из @deslop/primitives. */
  background: string;
  /** Адаптивный токен Primary 80 из @deslop/primitives. */
  foreground: string;
  muted: string;
  primary: string;
}

interface ReaderPageThemePreset {
  id: ReaderPageTheme;
  labelKey: string;
  labelDefault: string;
}

const SEPIA_COLORS: ReaderThemeColors = {
  background: "#efe1c6",
  foreground: "#3b3125",
  muted: "#8a7a63",
  primary: "#8a5a2b",
};

export const READER_PAGE_THEMES: ReaderPageThemePreset[] = [
  { id: "original", labelKey: "reader.pageThemeLight", labelDefault: "Light" },
  {
    id: "dark",
    labelKey: "reader.pageThemeDark",
    labelDefault: "Тёмная",
  },
  {
    id: "sepia",
    labelKey: "reader.pageThemeSepia",
    labelDefault: "Сепия",
  },
];

/** Тема, с которой ридер открывается в соответствии с темой приложения. */
export function getAppSyncedReaderTheme(isAppDark: boolean): ReaderPageTheme {
  return isAppDark ? "dark" : "original";
}

/** Scene surfaces follow the page, never the surrounding application's theme. */
export function resolveReaderScenePalette<
  T extends { primary4: string; elevation1: string; elevation2: string },
>(
  theme: string | undefined,
  light: T,
  dark: T,
  paperBackground: string,
): T & { sceneActionColor?: string } {
  // Lift Light slightly toward the existing white surface, keeping Sepia's paper intact.
  const buttonFill =
    theme === "sepia"
      ? paperBackground
      : `color-mix(in srgb, ${paperBackground} 70%, ${light.elevation2} 30%)`;
  return theme === "dark"
    ? dark
    : {
        ...light,
        elevation1: light.primary4,
        // Translucency belongs to the fill, never the label or icon.
        elevation2: `color-mix(in srgb, ${buttonFill} 70%, transparent)`,
        ...(theme === "sepia" ? { sceneActionColor: SEPIA_COLORS.foreground } : {}),
      };
}

/**
 * Передаёт адаптивные токены primitives без преобразования: Primary 10
 * остаётся фоном, Primary 80 — текстом.
 */
export function resolveReaderThemeTokens(tokens: ReaderThemeTokenPalette): ReaderThemeColors {
  return {
    background: tokens.background,
    foreground: tokens.foreground,
    muted: tokens.muted,
    primary: tokens.primary,
  };
}

export function resolveReaderThemeColors(
  theme: string | undefined,
  lightTokens: ReaderThemeTokenPalette,
  darkTokens: ReaderThemeTokenPalette,
): ReaderThemeColors {
  switch (theme) {
    case "sepia":
      return SEPIA_COLORS;
    case "dark":
      return resolveReaderThemeTokens(darkTokens);
    default:
      return resolveReaderThemeTokens(lightTokens);
  }
}

/**
 * Складывает полупрозрачный цвет с подложкой в плотный.
 *
 * Фон страницы — токен вида #1111111A, то есть плёнка 10%. Пока её кладёт один
 * слой, всё верно; но экран загрузки и сама страница — это разные слои, и
 * плёнка, наложенная дважды, темнеет. Поэтому фон везде берётся уже плотным.
 */
export function flattenReaderColor(color: string, backdrop: string): string {
  const hex = color.replace("#", "");
  if (hex.length !== 8) return color;

  const channel = (source: string, index: number) =>
    Number.parseInt(source.slice(index * 2, index * 2 + 2), 16);
  const alpha = channel(hex, 3) / 255;
  const base = backdrop.replace("#", "").slice(0, 6);
  if (base.length !== 6) return color;

  const mixed = [0, 1, 2].map((index) =>
    Math.round(channel(hex, index) * alpha + channel(base, index) * (1 - alpha))
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${mixed.join("")}`;
}
