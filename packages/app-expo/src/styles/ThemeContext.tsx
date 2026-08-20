import * as SecureStore from "expo-secure-store";
/**
 * ThemeContext — provides system / light / dark theme support.
 *
 * oklch values from globals.css are converted to hex.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useColorScheme } from "react-native";
import {
  type ResolvedThemeMode,
  type ThemeColors,
  type ThemeMode,
  makeThemeColors,
} from "./theme-colors";

export type { ThemeColors, ThemeMode };

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
