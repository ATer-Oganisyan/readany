import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  READER_PAGE_THEMES,
  type ReaderThemeTokenPalette,
  getAppSyncedReaderTheme,
  resolveReaderScenePalette,
  resolveReaderThemeColors,
} from "./reader-themes";

const lightTokens: ReaderThemeTokenPalette = {
  background: "#1111111a",
  foreground: "#111111cc",
  muted: "#777777",
  primary: "#3b82f6",
};

const darkTokens: ReaderThemeTokenPalette = {
  background: "#ffffff1a",
  foreground: "#ffffffcc",
  muted: "#888888",
  primary: "#6ea8fe",
};

describe("resolveReaderThemeColors", () => {
  it("Light and Sepia use light Primary 4 for the scene, Dark keeps Elevation 1", () => {
    const light = {
      primary4: "#1111110A",
      elevation1: "#FFFFFF",
      elevation2: "#FFFFFF",
      primary8: "#11111114",
    };
    const dark = {
      primary4: "#FFFFFF0A",
      elevation1: "#1D1D1D",
      elevation2: "#282828",
      primary8: "#FFFFFF14",
    };
    for (const theme of [undefined, "original"]) {
      expect(resolveReaderScenePalette(theme, light, dark, "#dedede")).toEqual({
        ...light,
        elevation1: light.primary4,
        elevation2: "color-mix(in srgb, #dedede 70%, transparent)",
      });
    }
    expect(resolveReaderScenePalette("sepia", light, dark, "#efe1c6")).toEqual({
      ...light,
      elevation1: light.primary4,
      elevation2: "color-mix(in srgb, #efe1c6 70%, transparent)",
      sceneActionColor: "#3b3125",
    });
    expect(resolveReaderScenePalette("dark", light, dark, "#282828")).toEqual(dark);
  });
  it("совместимый id Light, пустое и неизвестное значение — светлая палитра", () => {
    expect(resolveReaderThemeColors("original", lightTokens, darkTokens)).toEqual(lightTokens);
    expect(resolveReaderThemeColors(undefined, lightTokens, darkTokens)).toEqual(lightTokens);
    expect(resolveReaderThemeColors("legacy-value", lightTokens, darkTokens)).toEqual(lightTokens);
  });

  it("показывает Light, Dark, Sepia в заданном порядке в обеих локалях", () => {
    const en = JSON.parse(
      readFileSync(
        new URL("../../../../core/src/i18n/locales/en/reader.json", import.meta.url),
        "utf8",
      ),
    );
    const ru = JSON.parse(
      readFileSync(
        new URL("../../../../core/src/i18n/locales/ru/reader.json", import.meta.url),
        "utf8",
      ),
    );
    expect(READER_PAGE_THEMES.map((preset) => preset.id)).toEqual(["original", "dark", "sepia"]);
    expect(READER_PAGE_THEMES.map((preset) => en.reader[preset.labelKey.split(".")[1]])).toEqual([
      "Light",
      "Dark",
      "Sepia",
    ]);
    expect(READER_PAGE_THEMES.map((preset) => ru.reader[preset.labelKey.split(".")[1]])).toEqual([
      "Светлая",
      "Тёмная",
      "Сепия",
    ]);
  });

  it("тёмная тема без преобразования использует тёмные Primary 10 и Primary 80", () => {
    expect(resolveReaderThemeColors("dark", lightTokens, darkTokens)).toMatchObject({
      background: "#ffffff1a",
      foreground: "#ffffffcc",
    });
  });

  it("светлая тема без преобразования использует светлые Primary 10 и Primary 80", () => {
    expect(resolveReaderThemeColors("original", lightTokens, darkTokens)).toMatchObject({
      background: "#1111111a",
      foreground: "#111111cc",
    });
  });

  it("каждый пресет из списка разрешается без ошибок", () => {
    for (const preset of READER_PAGE_THEMES) {
      const resolved = resolveReaderThemeColors(preset.id, lightTokens, darkTokens);
      expect(resolved.background).toMatch(/^#/);
      expect(resolved.foreground).toMatch(/^#/);
    }
  });
});

describe("getAppSyncedReaderTheme", () => {
  it("открывает светлую тему приложения как Light с совместимым id", () => {
    expect(getAppSyncedReaderTheme(false)).toBe("original");
  });

  it("открывает тёмную тему приложения как тёмную тему ридера", () => {
    expect(getAppSyncedReaderTheme(true)).toBe("dark");
  });
});
