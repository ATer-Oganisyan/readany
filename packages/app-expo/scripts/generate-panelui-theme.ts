/**
 * Генератор темы Narra для PanelUI.
 *
 * PanelUI красит себя изнутри классами Tailwind, а те читают CSS-переменные.
 * Снаружи в них не попасть: style до внутренностей компонента не доходит.
 * Поэтому наши токены отдаём в той форме, которую библиотека умеет читать.
 *
 * Значения берутся из того же makeThemeColors, что и всё приложение, поэтому
 * второго списка цветов не появляется: правка палитры в deslop меняет и экраны,
 * и компоненты PanelUI одним прогоном.
 *
 * Запуск: pnpm run generate:panelui-theme
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { radiusPixels } from "@deslop/primitives";
import { type ResolvedThemeMode, makeThemeColors } from "../src/styles/theme-colors";

/**
 * Соответствие токенов PanelUI нашим цветам.
 *
 * Слева — имена, которые ждут классы библиотеки, справа — ключ из наших цветов.
 * Названия почти совпадают: PanelUI использует ту же семантику, что и наша
 * тема, поэтому большинство строк — прямое сопоставление.
 */
const COLOR_MAP: Record<string, keyof ReturnType<typeof makeThemeColors>> = {
  background: "background",
  foreground: "foreground",
  card: "card",
  "card-foreground": "cardForeground",
  popover: "elevation1",
  "popover-foreground": "foreground",
  overlay: "elevation1",
  "overlay-foreground": "foreground",
  inset: "primary5",
  primary: "primary",
  "primary-foreground": "primaryForeground",
  secondary: "primary5",
  "secondary-foreground": "foreground",
  muted: "muted",
  "muted-foreground": "mutedForeground",
  accent: "accent",
  "accent-foreground": "accentForeground",
  destructive: "destructive",
  "destructive-foreground": "destructiveForeground",
  border: "border",
  input: "border",
  ring: "primary",
};

/** Радиусы — из той же шкалы, что и остальные наши поверхности. */
const RADIUS_MAP: Record<string, number> = {
  "radius-xs": radiusPixels[6],
  "radius-sm": radiusPixels[10],
  "radius-md": radiusPixels[14],
  "radius-lg": radiusPixels[18],
  "radius-xl": radiusPixels[22],
  "radius-2xl": radiusPixels[26],
  "radius-3xl": radiusPixels[34],
};

function variantBlock(mode: ResolvedThemeMode): string {
  const colors = makeThemeColors(mode);
  const lines = Object.entries(COLOR_MAP).map(
    ([token, key]) => `    --color-${token}: ${colors[key].toLowerCase()};`,
  );
  return [`  @variant ${mode} {`, ...lines, "  }"].join("\n");
}

const radiusLines = Object.entries(RADIUS_MAP).map(([token, value]) => `  --${token}: ${value}px;`);

const css = `/*
 * СГЕНЕРИРОВАНО. Не править руками.
 *
 * Источник — packages/app-expo/src/styles/theme-colors.ts, то есть та же
 * палитра deslop, на которой работают экраны приложения. Перегенерация:
 * pnpm --filter @readany/app-expo run generate:panelui-theme
 *
 * Подключается в global.css после panelui-native/theme.css: одинаковые имена
 * переменных, наши значения — поэтому побеждает последнее объявление.
 */
:root {
${radiusLines.join("\n")}

${variantBlock("light")}

${variantBlock("dark")}
}
`;

const target = join(import.meta.dirname, "..", "src", "panelui-theme.css");
writeFileSync(target, css);
console.log(`Тема PanelUI собрана из токенов deslop: ${target}`);
