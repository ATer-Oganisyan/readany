import { type AdaptiveColor, accentColors, baseColors, primaryColors } from "@deslop/primitives";
import * as SecureStore from "expo-secure-store";
/**
 * ThemeContext — provides system / light / dark theme support.
 *
 * oklch values from globals.css are converted to hex.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useColorScheme } from "react-native";

export type ThemeMode = "system" | "light" | "dark";
type ResolvedThemeMode = Exclude<ThemeMode, "system">;

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
  primary80: string;
  primary30: string;
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

function makeThemeColors(mode: ResolvedThemeMode): ThemeColors {
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
    primary80: primaryScale("Primary 80"),
    primary30: primaryScale("Primary 30"),
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
  };
}

const lightColors = makeThemeColors("light");
const darkColors = makeThemeColors("dark");

const THEME_MAP: Record<ResolvedThemeMode, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
};

const STORAGE_KEY = "readany-theme";

export async function loadStoredThemeMode(): Promise<ThemeMode> {
  const saved = await SecureStore.getItemAsync(STORAGE_KEY);
  if (saved === "system" || saved === "light" || saved === "dark") return saved;
  // Migrate the removed sepia theme without exposing it during first render.
  if (saved === "sepia") return "system";
  return "system";
}

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  colors: lightColors,
  setMode: () => {},
  isDark: false,
});

export function ThemeProvider({
  children,
  initialMode,
}: {
  children: ReactNode;
  initialMode?: ThemeMode;
}) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode ?? "system");
  const systemColorScheme = useColorScheme();

  useEffect(() => {
    // The application preloads the value before mounting navigation. Keep the
    // fallback for isolated previews such as Storybook.
    if (initialMode !== undefined) return;
    void loadStoredThemeMode().then(setModeState);
  }, [initialMode]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    SecureStore.setItemAsync(STORAGE_KEY, m);
  }, []);

  const resolvedMode: ResolvedThemeMode =
    mode === "system" ? (systemColorScheme === "dark" ? "dark" : "light") : mode;

  const value: ThemeContextValue = {
    mode,
    colors: THEME_MAP[resolvedMode],
    setMode,
    isDark: resolvedMode === "dark",
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * Helper: get the initial theme synchronously for static styles.
 * Components that need reactive theme should use useTheme() instead.
 */
export { lightColors, darkColors, THEME_MAP };
