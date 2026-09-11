import { describe, expect, it, vi } from "vitest";

const device = vi.hoisted(() => ({ os: "ios", languages: ["ru-RU"], locale: "en_US" }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return device.os;
    },
  },
  Settings: { get: (key: string) => (key === "AppleLanguages" ? device.languages : device.locale) },
  I18nManager: { getConstants: () => ({ localeIdentifier: device.locale }) },
}));

import { getSystemLocale } from "./system-locale";

describe("system interface locale", () => {
  it.each([
    ["ios", ["ru-RU", "en-US"], "en_US", "ru-RU"],
    ["ios", ["en-GB", "ru-RU"], "ru_RU", "en-GB"],
    ["ios", ["en-RU", "ru-RU"], "ru_RU", "en-RU"],
    ["ios", [], "ru_RU", "ru-RU"],
    ["android", [], "ru_RU", "ru-RU"],
    ["android", [], "en_US", "en-US"],
  ])("reads %s language preferences %j with region %s", (os, languages, locale, expected) => {
    Object.assign(device, { os, languages, locale });
    expect(getSystemLocale()).toBe(expected);
  });
  it("falls back to Intl when native preferences are empty", () => {
    Object.assign(device, { os: "ios", languages: [], locale: "" });
    const intl = vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ locale: "ru_RU" }),
    } as Intl.DateTimeFormat);
    try {
      expect(getSystemLocale()).toBe("ru-RU");
    } finally {
      intl.mockRestore();
    }
  });

});
