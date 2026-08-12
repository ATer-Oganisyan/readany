import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en_chat from "./locales/en/chat.json";
import en_common from "./locales/en/common.json";
import en_library from "./locales/en/library.json";
import en_misc from "./locales/en/misc.json";
import en_notes from "./locales/en/notes.json";
import en_onboarding from "./locales/en/onboarding.json";
import en_profile from "./locales/en/profile.json";
import en_reader from "./locales/en/reader.json";
import en_settings from "./locales/en/settings.json";
import en_stats from "./locales/en/stats.json";
import en_translation from "./locales/en/translation.json";
import en_tts from "./locales/en/tts.json";
import ru_chat from "./locales/ru/chat.json";
import ru_common from "./locales/ru/common.json";
import ru_library from "./locales/ru/library.json";
import ru_misc from "./locales/ru/misc.json";
import ru_notes from "./locales/ru/notes.json";
import ru_onboarding from "./locales/ru/onboarding.json";
import ru_profile from "./locales/ru/profile.json";
import ru_reader from "./locales/ru/reader.json";
import ru_settings from "./locales/ru/settings.json";
import ru_stats from "./locales/ru/stats.json";
import ru_translation from "./locales/ru/translation.json";
import ru_tts from "./locales/ru/tts.json";

const en = {
  ...en_common,
  ...en_library,
  ...en_reader,
  ...en_chat,
  ...en_notes,
  ...en_settings,
  ...en_translation,
  ...en_tts,
  ...en_stats,
  ...en_onboarding,
  ...en_profile,
  ...en_misc,
};

const ru = {
  ...ru_common,
  ...ru_library,
  ...ru_reader,
  ...ru_chat,
  ...ru_notes,
  ...ru_settings,
  ...ru_translation,
  ...ru_tts,
  ...ru_stats,
  ...ru_onboarding,
  ...ru_profile,
  ...ru_misc,
};

export const INTERFACE_LANGUAGES = ["ru", "en"] as const;
export type InterfaceLanguage = (typeof INTERFACE_LANGUAGES)[number];

export function resolveInterfaceLanguage(value?: string | null): InterfaceLanguage {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "en" || normalized.startsWith("en-") ? "en" : "ru";
}

export const i18nReady = i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: "ru",
  fallbackLng: "ru",
  supportedLngs: [...INTERFACE_LANGUAGES],
  interpolation: {
    escapeValue: false,
  },
});

/** Restore the saved language, or use the supported system language for a new user. */
export async function initI18nLanguage(): Promise<void> {
  try {
    const { getPlatformService } = await import("../services/platform");
    const platform = getPlatformService();
    const savedLanguage = await platform.kvGetItem("readany-lang");
    const systemLocale = savedLanguage ? null : await platform.getLocale?.();
    const language = resolveInterfaceLanguage(savedLanguage || systemLocale);
    await i18n.changeLanguage(language);
    await platform.kvSetItem("readany-lang", language);
  } catch {
    await i18n.changeLanguage("ru");
  }
}

/** Change the interface language and persist the supported value. */
export async function changeAndPersistLanguage(lang: string): Promise<void> {
  const language = resolveInterfaceLanguage(lang);
  await i18n.changeLanguage(language);

  try {
    const { getPlatformService } = await import("../services/platform");
    await getPlatformService().kvSetItem("readany-lang", language);
  } catch {
    // Persistence is optional; the current session has already changed language.
  }
}

export default i18n;
