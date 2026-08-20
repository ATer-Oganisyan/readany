import { useTheme } from "@/styles/theme";
import { useThemeMode } from "panelui-native";
import { useEffect } from "react";

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
  const { isDark } = useTheme();
  const { mode, setMode } = useThemeMode();

  useEffect(() => {
    const next = isDark ? "dark" : "light";
    if (mode !== next) setMode(next);
  }, [isDark, mode, setMode]);

  return null;
}
