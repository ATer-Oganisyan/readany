import { I18nManager, Platform, Settings } from "react-native";

/** Read the preferred interface language, rather than the date-formatting locale. */
export function getSystemLocale(): string {
  const languages = Platform.OS === "ios" ? Settings.get("AppleLanguages") : undefined;
  const locale =
    Platform.OS === "ios"
      ? (Array.isArray(languages) ? languages[0] : undefined) || Settings.get("AppleLocale")
      : I18nManager.getConstants().localeIdentifier;

  return (
    typeof locale === "string" && locale
      ? locale
      : Intl.DateTimeFormat().resolvedOptions().locale || "en"
  ).replace(/_/g, "-");
}
