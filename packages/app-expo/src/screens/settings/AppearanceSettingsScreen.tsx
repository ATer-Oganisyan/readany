import { NativeSettingsPicker } from "@/components/settings/NativeSettingsPicker";
import { Text } from "@/components/ui/Typography";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useTheme } from "@/styles/ThemeContext";
import type { ThemeMode } from "@/styles/ThemeContext";
import { fontSize, fontWeight, radius, secondLevelTitleFontFamily, spacing } from "@/styles/theme";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsHeader } from "./SettingsHeader";

const THEMES: { id: ThemeMode; labelKey: string; fallback: string }[] = [
  { id: "system", labelKey: "settings.system", fallback: "Системная" },
  { id: "light", labelKey: "settings.light", fallback: "Светлая" },
  { id: "dark", labelKey: "settings.dark", fallback: "Тёмная" },
];

const LANGUAGES = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
] as const;

export default function AppearanceSettingsScreen() {
  const { t, i18n } = useTranslation();
  const { mode, setMode, colors, isDark } = useTheme();
  const layout = useResponsiveLayout();
  const [lang, setLang] = useState(() => i18n.resolvedLanguage || i18n.language || "ru");

  useEffect(() => {
    setLang(i18n.resolvedLanguage || i18n.language || "ru");
  }, [i18n.language, i18n.resolvedLanguage]);

  const handleLangChange = useCallback(async (code: string) => {
    setLang(code);
    try {
      const { changeAndPersistLanguage } = await import("@readany/core/i18n");
      await changeAndPersistLanguage(code);
    } catch (err) {
      console.warn("[Settings] Failed to change and persist language:", err);
    }
  }, []);

  const s = makeStyles();
  const colorScheme = isDark ? "dark" : "light";

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={[]}>
      <SettingsHeader title={t("settings.general", "通用")} subtitle={t("settings.realtimeHint")} />

      <ScrollView
        style={s.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[s.scrollContent, { alignItems: "center" }]}
      >
        <View style={{ width: "100%", maxWidth: layout.centeredContentWidth, gap: 24 }}>
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>
              {t("settings.theme", "主题")}
            </Text>
            <View
              style={[
                s.nativePickerCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <NativeSettingsPicker
                label={t("settings.theme", "Тема")}
                selectedValue={mode}
                options={THEMES.map((item) => ({
                  label: t(item.labelKey, item.fallback),
                  value: item.id,
                }))}
                onValueChange={(value) => {
                  if (value === "system" || value === "light" || value === "dark") {
                    setMode(value);
                  }
                }}
                colorScheme={colorScheme}
              />
            </View>
          </View>

          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>
              {t("settings.language", "语言")}
            </Text>
            <View
              style={[
                s.nativePickerCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <NativeSettingsPicker
                label={t("settings.language", "Язык")}
                selectedValue={lang}
                options={LANGUAGES}
                onValueChange={(value) => void handleLangChange(value)}
                colorScheme={colorScheme}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xxl,
      paddingBottom: 56,
      gap: 24,
    },
    section: { gap: 12 },
    sectionTitle: {
      fontFamily: secondLevelTitleFontFamily,
      fontSize: fontSize.base,
      fontWeight: fontWeight.normal,
    },
    nativePickerCard: {
      borderRadius: radius.xl,
      borderWidth: 1,
      overflow: "hidden",
    },
  });
}
