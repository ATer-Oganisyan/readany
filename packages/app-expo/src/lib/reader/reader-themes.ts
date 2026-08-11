/**
 * Темы страницы читалки — пресеты фона и текста в стиле Apple Books
 * (образец — панель «Темы и настройки» narra).
 *
 * «Оригинал» следует теме приложения; «Сепия» и «Тёмная» переопределяют
 * цвета всей поверхности ридера и содержимого WebView.
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
  { id: "original", labelKey: "reader.pageThemeOriginal", labelDefault: "Оригинал" },
  {
    id: "sepia",
    labelKey: "reader.pageThemeSepia",
    labelDefault: "Сепия",
  },
  {
    id: "dark",
    labelKey: "reader.pageThemeDark",
    labelDefault: "Тёмная",
  },
];

/** Тема, с которой ридер открывается в соответствии с темой приложения. */
export function getAppSyncedReaderTheme(isAppDark: boolean): ReaderPageTheme {
  return isAppDark ? "dark" : "original";
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
  appTokens: ReaderThemeTokenPalette,
  darkTokens: ReaderThemeTokenPalette,
): ReaderThemeColors {
  switch (theme) {
    case "sepia":
      return SEPIA_COLORS;
    case "dark":
      return resolveReaderThemeTokens(darkTokens);
    default:
      return resolveReaderThemeTokens(appTokens);
  }
}
