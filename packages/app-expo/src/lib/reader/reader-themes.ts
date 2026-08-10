/**
 * Темы страницы читалки — пресеты фона и текста в стиле Apple Books
 * (образец — панель «Темы и настройки» narra).
 *
 * «Оригинал» следует теме приложения; «Сепия» и «Тёмная» переопределяют
 * цвета только внутри WebView (через setThemeColors), интерфейс вокруг
 * страницы остаётся в теме приложения.
 */

export type ReaderPageTheme = "original" | "sepia" | "dark";

export interface ReaderThemeColors {
  background: string;
  foreground: string;
  muted: string;
  primary: string;
}

interface ReaderPageThemePreset {
  id: ReaderPageTheme;
  labelKey: string;
  labelDefault: string;
  /** Цвета плитки-превью; у «Оригинала» берутся из темы приложения */
  preview?: { bg: string; ink: string };
}

const SEPIA_COLORS: ReaderThemeColors = {
  background: "#efe1c6",
  foreground: "#3b3125",
  muted: "#8a7a63",
  primary: "#8a5a2b",
};

const DARK_COLORS: ReaderThemeColors = {
  background: "#ffffff1a",
  foreground: "#ffffffcc",
  muted: "#8e8e93",
  primary: "#6ea8fe",
};

export const READER_PAGE_THEMES: ReaderPageThemePreset[] = [
  { id: "original", labelKey: "reader.pageThemeOriginal", labelDefault: "Оригинал" },
  {
    id: "sepia",
    labelKey: "reader.pageThemeSepia",
    labelDefault: "Сепия",
    preview: { bg: SEPIA_COLORS.background, ink: SEPIA_COLORS.foreground },
  },
  {
    id: "dark",
    labelKey: "reader.pageThemeDark",
    labelDefault: "Тёмная",
    preview: { bg: DARK_COLORS.background, ink: DARK_COLORS.foreground },
  },
];

/** Тема, с которой ридер открывается в соответствии с темой приложения. */
export function getAppSyncedReaderTheme(isAppDark: boolean): ReaderPageTheme {
  return isAppDark ? "dark" : "original";
}

/**
 * Цвета страницы для выбранного пресета. Неизвестное или пустое значение
 * (старые сохранённые настройки) — это «Оригинал», то есть цвета приложения.
 */
export function resolveReaderThemeColors(
  theme: string | undefined,
  appColors: ReaderThemeColors,
): ReaderThemeColors {
  switch (theme) {
    case "sepia":
      return SEPIA_COLORS;
    case "dark":
      return DARK_COLORS;
    default:
      return appColors;
  }
}
