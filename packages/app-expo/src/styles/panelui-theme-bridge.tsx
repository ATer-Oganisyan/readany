import { useTheme } from "@/styles/theme";
import { useThemeMode } from "panelui-native";
import { useEffect } from "react";
import { Uniwind, useUniwind } from "uniwind";

/**
 * Подчиняет тему PanelUI нашей настройке внешнего вида.
 *
 * У нас режим — пользовательская настройка с тремя состояниями: системная,
 * светлая, тёмная. У PanelUI своя тема со своим переключателем. Без этой связи
 * приложение и компоненты библиотеки разойдутся: экран тёмный, а чат светлый.
 *
 * Значения переменных при этом наши — их подставляет сгенерированный
 * panelui-theme.css. Здесь переключается только то, какой из двух блоков,
 * светлый или тёмный, считается активным.
 */
export function PanelUIThemeBridge() {
  const { mode: appMode, isDark } = useTheme();
  const { mode, setMode } = useThemeMode();
  const { hasAdaptiveThemes } = useUniwind();

  useEffect(() => {
    if (appMode === "system") {
      // PanelUI's concrete modes also override RN Appearance. Clear that
      // override before treating useColorScheme as the device preference.
      if (!hasAdaptiveThemes) Uniwind.setTheme("system");
      return;
    }
    const next = isDark ? "dark" : "light";
    if (hasAdaptiveThemes || mode !== next) setMode(next);
  }, [appMode, hasAdaptiveThemes, isDark, mode, setMode]);

  return null;
}
