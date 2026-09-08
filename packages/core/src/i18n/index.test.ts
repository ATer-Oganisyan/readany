import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { IPlatformService } from "../services/platform";
import { setPlatformService } from "../services/platform";
import { ENGLISH_SOURCE_REVISIONS } from "./english-source-revisions";
import i18n, {
  changeAndPersistLanguage,
  i18nReady,
  initI18nLanguage,
  resolveInterfaceLanguage,
} from "./index";

function localizationPlatform(
  locale: string,
  initialStorage: Record<string, string> = {},
): { service: IPlatformService; storage: Map<string, string> } {
  const storage = new Map(Object.entries(initialStorage));
  const service = {
    getLocale: async () => locale,
    kvGetItem: async (key: string) => storage.get(key) ?? null,
    kvSetItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
  } as IPlatformService;
  return { service, storage };
}

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
    expect(resolveInterfaceLanguage("ru")).toBe("ru");
    expect(resolveInterfaceLanguage("en-US")).toBe("en");
    expect(resolveInterfaceLanguage("de-DE")).toBe("en");
    expect(resolveInterfaceLanguage("zh")).toBe("en");
    expect(resolveInterfaceLanguage()).toBe("en");
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

  it("uses Russian only for a Russian system locale", async () => {
    const russian = localizationPlatform("ru-RU");
    setPlatformService(russian.service);
    await initI18nLanguage();
    expect(i18n.resolvedLanguage).toBe("ru");

    const nonRussian = localizationPlatform("de-DE");
    setPlatformService(nonRussian.service);
    await initI18nLanguage();
    expect(i18n.resolvedLanguage).toBe("en");
  });

  it("keeps a manually selected language instead of the system language", async () => {
    const platform = localizationPlatform("en-US", {
      "readany-lang": "ru",
      "readany-lang-source": "manual",
    });
    setPlatformService(platform.service);
    await initI18nLanguage();
    expect(i18n.resolvedLanguage).toBe("ru");

    await changeAndPersistLanguage("en");
    expect(platform.storage.get("readany-lang")).toBe("en");
    expect(platform.storage.get("readany-lang-source")).toBe("manual");
  });

  it("uses the system locale when an old saved language has no manual marker", async () => {
    const platform = localizationPlatform("en-US", { "readany-lang": "ru" });
    setPlatformService(platform.service);
    await initI18nLanguage();
    expect(i18n.resolvedLanguage).toBe("en");
    expect(platform.storage.get("readany-lang-source")).toBe("system");
  });

  it("keeps the English dictionary in parity with Russian", async () => {
    await i18nReady;
    const russianKeys = flattenKeys(i18n.getResourceBundle("ru", "translation")).sort();
    const englishKeys = flattenKeys(i18n.getResourceBundle("en", "translation")).sort();
    expect(englishKeys).toEqual(russianKeys);
  });

  it("keeps every English locale file in parity with its Russian source", () => {
    for (const fileName of Object.keys(ENGLISH_SOURCE_REVISIONS)) {
      const russian = JSON.parse(
        readFileSync(new URL(`./locales/ru/${fileName}`, import.meta.url), "utf8"),
      );
      const english = JSON.parse(
        readFileSync(new URL(`./locales/en/${fileName}`, import.meta.url), "utf8"),
      );

      expect(flattenKeys(english).sort(), fileName).toEqual(flattenKeys(russian).sort());
    }
  });

  it("keeps interpolation variables identical in both languages", async () => {
    await i18nReady;
    const russian = flattenStrings(i18n.getResourceBundle("ru", "translation"));
    const english = flattenStrings(i18n.getResourceBundle("en", "translation"));

    for (const [key, russianText] of russian) {
      expect(placeholders(english.get(key) ?? ""), key).toEqual(placeholders(russianText));
    }
  });

  it("requires an English review whenever the Russian source copy changes", () => {
    for (const [fileName, reviewedRevision] of Object.entries(ENGLISH_SOURCE_REVISIONS)) {
      const source = readFileSync(new URL(`./locales/ru/${fileName}`, import.meta.url));
      const currentRevision = createHash("sha256").update(source).digest("hex");
      expect(
        currentRevision,
        `${fileName} changed in Russian. Review the matching English locale before updating its source revision.`,
      ).toBe(reviewedRevision);
    }
  });
});
