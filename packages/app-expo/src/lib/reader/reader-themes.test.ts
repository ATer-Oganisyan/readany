import { describe, expect, it } from "vitest";
import {
  READER_PAGE_THEMES,
  type ReaderThemeTokenPalette,
  getAppSyncedReaderTheme,
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
  it("«Оригинал», пустое и неизвестное значение — цвета приложения", () => {
    expect(resolveReaderThemeColors("original", lightTokens, darkTokens)).toEqual(lightTokens);
    expect(resolveReaderThemeColors(undefined, lightTokens, darkTokens)).toEqual(lightTokens);
    expect(resolveReaderThemeColors("legacy-value", lightTokens, darkTokens)).toEqual(lightTokens);
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
  it("открывает светлую тему приложения как оригинальную тему ридера", () => {
    expect(getAppSyncedReaderTheme(false)).toBe("original");
  });

  it("открывает тёмную тему приложения как тёмную тему ридера", () => {
    expect(getAppSyncedReaderTheme(true)).toBe("dark");
  });
});
