import { describe, expect, it } from "vitest";
import {
  READER_PAGE_THEMES,
  type ReaderThemeColors,
  getAppSyncedReaderTheme,
  resolveReaderThemeColors,
} from "./reader-themes";

const appColors: ReaderThemeColors = {
  background: "#ffffff",
  foreground: "#111111",
  muted: "#777777",
  primary: "#3b82f6",
};

describe("resolveReaderThemeColors", () => {
  it("«Оригинал», пустое и неизвестное значение — цвета приложения", () => {
    expect(resolveReaderThemeColors("original", appColors)).toEqual(appColors);
    expect(resolveReaderThemeColors(undefined, appColors)).toEqual(appColors);
    expect(resolveReaderThemeColors("legacy-value", appColors)).toEqual(appColors);
  });

  it("«Сепия» и «Тёмная» — собственные палитры, не совпадающие с приложением", () => {
    for (const theme of ["sepia", "dark"] as const) {
      const resolved = resolveReaderThemeColors(theme, appColors);
      expect(resolved.background).not.toBe(appColors.background);
      expect(resolved.foreground).not.toBe(appColors.foreground);
      // Фон и текст обязаны различаться — страница остаётся читаемой
      expect(resolved.background).not.toBe(resolved.foreground);
    }
  });

  it("тёмная тема использует Primary 10 и Primary 80", () => {
    expect(resolveReaderThemeColors("dark", appColors)).toMatchObject({
      background: "#ffffff1a",
      foreground: "#ffffffcc",
    });
  });

  it("каждый пресет из списка разрешается без ошибок", () => {
    for (const preset of READER_PAGE_THEMES) {
      const resolved = resolveReaderThemeColors(preset.id, appColors);
      expect(resolved.background).toMatch(/^#/);
      expect(resolved.foreground).toMatch(/^#/);
    }
  });

  it("плитки-превью пресетов совпадают с фактическими цветами страницы", () => {
    for (const preset of READER_PAGE_THEMES) {
      if (!preset.preview) continue;
      const resolved = resolveReaderThemeColors(preset.id, appColors);
      expect(preset.preview.bg).toBe(resolved.background);
      expect(preset.preview.ink).toBe(resolved.foreground);
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
