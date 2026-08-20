/**
 * Цвета темы — чистый модуль без React.
 *
 * Вынесен из ThemeContext, чтобы один и тот же расчёт читали и приложение, и
 * генератор темы для PanelUI (scripts/generate-panelui-theme.ts). Иначе
 * получились бы два списка цветов, которые разъедутся при первой же правке
 * палитры.
 */
import { type AdaptiveColor, accentColors, baseColors, primaryColors } from "@deslop/primitives";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedThemeMode = Exclude<ThemeMode, "system">;

export interface ThemeColors {
  backgroundPrimary: string;
  backgroundSecondary: string;
  elevation1: string;
  elevation2: string;
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  primary: string;
  primary5: string;
  primary10: string;
  primary20: string;
  primary30: string;
  primary60: string;
  primary80: string;
  primaryForeground: string;
  destructive: string;
  destructiveForeground: string;
  accent: string;
  accentForeground: string;
  // Functional
  indigo: string;
  emerald: string;
  amber: string;
  blue: string;
  violet: string;
  // Highlight colors
  highlightYellow: string;
  highlightGreen: string;
  highlightBlue: string;
  highlightPink: string;
  highlightPurple: string;
  // Fallback cover gradients
  stone100: string;
  stone200: string;
  stone300: string;
  stone400: string;
  stone500: string;
  /** Светлая бумажная поверхность заглушки: типографика обложки всегда тёмная. */
  bookCoverSurface: string;
}

function adaptiveToken(
  palette: readonly AdaptiveColor[],
  name: string,
  mode: ResolvedThemeMode,
): string {
  const token = palette.find((color) => color.name === name);
  if (!token) throw new Error(`Missing @deslop/primitives color token: ${name}`);
  return token[mode];
}

function mixHex(foreground: string, background: string, opacity: number): string {
  const parse = (hex: string) => {
    const value = hex.replace("#", "").slice(0, 6);
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ];
  };
  const foregroundRgb = parse(foreground);
  const backgroundRgb = parse(background);
  const channel = (index: number) =>
    Math.round(foregroundRgb[index] * opacity + backgroundRgb[index] * (1 - opacity))
      .toString(16)
      .padStart(2, "0");

  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

export function makeThemeColors(mode: ResolvedThemeMode): ThemeColors {
  const base = (name: string) => adaptiveToken(baseColors, name, mode);
  const primaryScale = (name: string) => adaptiveToken(primaryColors, name, mode);
  const accentScale = (name: string) => adaptiveToken(accentColors, name, mode);
  const backgroundPrimary = base("Background Primary");
  const backgroundSecondary = base("Background Secondary");
  const elevation1 = base("Elevation 1");
  const elevation2 = base("Elevation 2");
  const foreground = primaryScale("Primary");
  const primary = accentScale("Orange");

  return {
    backgroundPrimary,
    backgroundSecondary,
    elevation1,
    elevation2,
    // Existing semantic aliases keep screens on the Primitives surface scale.
    background: backgroundSecondary,
    foreground,
    card: elevation1,
    cardForeground: foreground,
    muted: mixHex(foreground, backgroundSecondary, 0.05),
    mutedForeground: mixHex(foreground, backgroundSecondary, 0.5),
    border: mixHex(foreground, backgroundSecondary, 0.1),
    primary,
    primary5: primaryScale("Primary 5"),
    primary10: primaryScale("Primary 10"),
    primary20: primaryScale("Primary 20"),
    primary30: primaryScale("Primary 30"),
    primary60: primaryScale("Primary 60"),
    primary80: primaryScale("Primary 80"),
    primaryForeground: base("Black"),
    destructive: accentScale("Red"),
    destructiveForeground: base("White"),
    accent: mixHex(primary, elevation1, 0.08),
    accentForeground: primary,
    indigo: accentScale("Indigo"),
    emerald: accentScale("Green"),
    amber: primary,
    blue: accentScale("Blue"),
    violet: accentScale("Purple"),
    highlightYellow: mixHex(accentScale("Yellow"), elevation1, 0.28),
    highlightGreen: mixHex(accentScale("Green"), elevation1, 0.24),
    highlightBlue: mixHex(accentScale("Blue"), elevation1, 0.22),
    highlightPink: mixHex(accentScale("Pink"), elevation1, 0.22),
    highlightPurple: mixHex(accentScale("Purple"), elevation1, 0.22),
    stone100: mixHex(foreground, backgroundSecondary, 0.05),
    stone200: mixHex(foreground, backgroundSecondary, 0.1),
    stone300: mixHex(foreground, backgroundSecondary, 0.2),
    stone400: mixHex(foreground, backgroundSecondary, 0.4),
    stone500: mixHex(foreground, backgroundSecondary, 0.6),
    bookCoverSurface: mixHex(foreground, backgroundSecondary, mode === "dark" ? 0.78 : 0.08),
  };
}
