import i18n from "i18next";
import { initReactI18next } from "react-i18next";

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

export const i18nReady = i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
  },
  lng: "ru",
  fallbackLng: "ru",
  supportedLngs: ["ru"],
  interpolation: {
    escapeValue: false,
  },
});

/** Fix the interface language to Russian and migrate any saved preference. */
export async function initI18nLanguage(): Promise<void> {
  await i18n.changeLanguage("ru");

  try {
    const { getPlatformService } = await import("../services/platform");
    await getPlatformService().kvSetItem("readany-lang", "ru");
  } catch {
    // Platform storage is optional; the in-memory locale is already Russian.
  }
}

/** Kept for API compatibility. Russian is the only supported interface language. */
export async function changeAndPersistLanguage(_lang: string): Promise<void> {
  await initI18nLanguage();
}

export default i18n;
