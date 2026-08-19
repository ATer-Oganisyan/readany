import { describe, expect, it } from "vitest";
import i18n, { i18nReady, resolveInterfaceLanguage } from "./index";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function flattenStrings(value: unknown, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") result.set(path, child);
    else for (const [childKey, text] of flattenStrings(child, path)) result.set(childKey, text);
  }
  return result;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([^},\s]+)/g)].map((match) => match[1]).sort();
}

describe("interface localization", () => {
  it("supports only Russian and English locale variants", () => {
    expect(resolveInterfaceLanguage("ru-RU")).toBe("ru");
    expect(resolveInterfaceLanguage("en-US")).toBe("en");
    expect(resolveInterfaceLanguage("de-DE")).toBe("ru");
    expect(resolveInterfaceLanguage("zh")).toBe("ru");
  });

  it("registers both complete interface resources", async () => {
    await i18nReady;
    expect(i18n.hasResourceBundle("ru", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);

    await i18n.changeLanguage("en");
    expect(i18n.t("tabs.library")).toBe("Library");
    await i18n.changeLanguage("ru");
    expect(i18n.t("tabs.library")).toBe("Библиотека");
  });

  it("keeps the English dictionary in parity with Russian", async () => {
    await i18nReady;
    const russianKeys = flattenKeys(i18n.getResourceBundle("ru", "translation")).sort();
    const englishKeys = flattenKeys(i18n.getResourceBundle("en", "translation")).sort();
    expect(englishKeys).toEqual(russianKeys);
  });

  it("mentions AO3 in the link import dialog in both languages", async () => {
    await i18nReady;

    await i18n.changeLanguage("en");
    expect(i18n.t("library.importSourceUrlDesc")).toContain("AO3");
    await i18n.changeLanguage("ru");
    expect(i18n.t("library.importSourceUrlDesc")).toContain("AO3");
  });

  it("keeps interpolation variables identical in both languages", async () => {
    await i18nReady;
    const russian = flattenStrings(i18n.getResourceBundle("ru", "translation"));
    const english = flattenStrings(i18n.getResourceBundle("en", "translation"));

    for (const [key, russianText] of russian) {
      expect(placeholders(english.get(key) ?? ""), key).toEqual(placeholders(russianText));
    }
  });
});
