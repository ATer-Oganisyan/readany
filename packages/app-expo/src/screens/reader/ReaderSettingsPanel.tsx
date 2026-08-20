/**
 * ReaderSettingsPanel — bottom-sheet modal for reading display settings.
 */
import { XIcon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { SCENE_SUGGESTION_INTERVALS } from "@/lib/narra/scene-suggestion";
import { READER_PAGE_THEMES, resolveReaderThemeColors } from "@/lib/reader/reader-themes";
import { useNarraStore } from "@/stores";
import { darkColors } from "@/styles/ThemeContext";
import { useColors } from "@/styles/theme";
import type { ReadSettings } from "@readany/core/types";
import { useTranslation } from "react-i18next";
import { Modal, Platform, Pressable, ScrollView, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles } from "./reader-styles";

interface Props {
  visible: boolean;
  readSettings: ReadSettings;
  onClose: () => void;
  onUpdateSetting: <K extends keyof ReadSettings>(key: K, value: ReadSettings[K]) => void;
}

export function ReaderSettingsPanel({ visible, readSettings, onClose, onUpdateSetting }: Props) {
  const colors = useColors();
  const s = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const { t } = useTranslation();

  const {
    fontSize: settingFontSize,
    lineHeight: settingLineHeight,
    paragraphSpacing: settingParagraphSpacing,
    pageMargin: settingPageMargin,
    viewMode: settingViewMode,
    volumeButtonsPageTurn,
    showTopTitleProgress,
  } = readSettings;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.modalBackdrop} onPress={onClose} />
      <View
        style={[
          s.bottomSheet,
          { paddingBottom: insets.bottom || 16 },
          layout.isTablet && {
            width: "100%",
          },
        ]}
      >
        <View style={s.sheetHeader}>
          <Text style={s.sheetTitle}>{t("reader.settings", "阅读设置")}</Text>
          <TouchableOpacity onPress={onClose}>
            <XIcon size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Тема страницы (пресеты фона/текста, образец narra) */}
          <View style={[s.settingRow, { flexDirection: "column", alignItems: "stretch", gap: 10 }]}>
            <Text style={s.settingLabel}>{t("reader.pageTheme", "Тема страницы")}</Text>
            <View style={s.pageThemeRow}>
              {READER_PAGE_THEMES.map((preset) => {
                const active = (readSettings.readerTheme ?? "original") === preset.id;
                const preview = resolveReaderThemeColors(
                  preset.id,
                  {
                    background: colors.primary10,
                    foreground: colors.primary80,
                    muted: colors.mutedForeground,
                    primary: colors.primary,
                  },
                  {
                    background: darkColors.primary10,
                    foreground: darkColors.primary80,
                    muted: darkColors.mutedForeground,
                    primary: darkColors.primary,
                  },
                );
                return (
                  <TouchableOpacity
                    key={preset.id}
                    style={[
                      s.pageThemeTile,
                      { backgroundColor: preview.background },
                      active && s.pageThemeTileActive,
                    ]}
                    onPress={() => onUpdateSetting("readerTheme", preset.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[s.pageThemeTileAa, { color: preview.foreground }]}>Aa</Text>
                    <Text style={[s.pageThemeTileLabel, { color: preview.foreground }]}>
                      {t(preset.labelKey, preset.labelDefault)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          {/* Font Size */}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("reader.fontSize", "字号")}</Text>
            <View style={s.settingControl}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => onUpdateSetting("fontSize", Math.max(12, settingFontSize - 1))}
              >
                <Text style={s.stepBtnText}>A-</Text>
              </TouchableOpacity>
              <Text style={s.settingValue}>{settingFontSize}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => onUpdateSetting("fontSize", Math.min(64, settingFontSize + 1))}
              >
                <Text style={s.stepBtnText}>A+</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Line Height */}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("reader.lineHeight", "行高")}</Text>
            <View style={s.settingControl}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() =>
                  onUpdateSetting(
                    "lineHeight",
                    Math.round(Math.max(1.2, settingLineHeight - 0.1) * 10) / 10,
                  )
                }
              >
                <Text style={s.stepBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={s.settingValue}>{settingLineHeight.toFixed(1)}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() =>
                  onUpdateSetting(
                    "lineHeight",
                    Math.round(Math.min(2.5, settingLineHeight + 0.1) * 10) / 10,
                  )
                }
              >
                <Text style={s.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Paragraph Spacing */}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("reader.paragraphSpacing", "段间距")}</Text>
            <View style={s.settingControl}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() =>
                  onUpdateSetting("paragraphSpacing", Math.max(0, settingParagraphSpacing - 2))
                }
              >
                <Text style={s.stepBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={s.settingValue}>{settingParagraphSpacing}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() =>
                  onUpdateSetting("paragraphSpacing", Math.min(24, settingParagraphSpacing + 2))
                }
              >
                <Text style={s.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Page Margin */}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("reader.pageMargin", "页边距")}</Text>
            <View style={s.settingControl}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => onUpdateSetting("pageMargin", Math.max(0, settingPageMargin - 4))}
              >
                <Text style={s.stepBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={s.settingValue}>{settingPageMargin}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => onUpdateSetting("pageMargin", Math.min(48, settingPageMargin + 4))}
              >
                <Text style={s.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* View Mode */}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("reader.viewMode", "阅读模式")}</Text>
            <View style={s.viewModeRow}>
              <TouchableOpacity
                style={[s.viewModeBtn, settingViewMode === "paginated" && s.viewModeBtnActive]}
                onPress={() => onUpdateSetting("viewMode", "paginated")}
              >
                <Text
                  style={[
                    s.viewModeBtnText,
                    settingViewMode === "paginated" && s.viewModeBtnTextActive,
                  ]}
                >
                  {t("reader.paginated", "翻页")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.viewModeBtn, settingViewMode === "scroll" && s.viewModeBtnActive]}
                onPress={() => onUpdateSetting("viewMode", "scroll")}
              >
                <Text
                  style={[
                    s.viewModeBtnText,
                    settingViewMode === "scroll" && s.viewModeBtnTextActive,
                  ]}
                >
                  {t("reader.scrollMode", "滚动")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          {Platform.OS === "android" && (
            <View style={s.settingRow}>
              <View style={s.settingLabelBlock}>
                <Text style={s.settingLabel}>{t("settings.volumeButtonsPageTurn")}</Text>
                <Text style={s.settingHint}>
                  {t("settings.volumeButtonsPageTurnDesc", "开启后阅读时音量键用于上下翻页")}
                </Text>
              </View>
              <TouchableOpacity
                style={[s.settingToggleBtn, !!volumeButtonsPageTurn && s.settingToggleBtnActive]}
                onPress={() => onUpdateSetting("volumeButtonsPageTurn", !volumeButtonsPageTurn)}
              >
                <Text
                  style={[
                    s.settingToggleText,
                    !!volumeButtonsPageTurn && s.settingToggleTextActive,
                  ]}
                >
                  {volumeButtonsPageTurn ? t("settings.enabled") : t("settings.disabled")}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("settings.showTopTitleProgress")}</Text>
            <TouchableOpacity
              style={[
                s.settingToggleBtn,
                showTopTitleProgress !== false && s.settingToggleBtnActive,
              ]}
              onPress={() =>
                onUpdateSetting("showTopTitleProgress", !(showTopTitleProgress !== false))
              }
            >
              <Text
                style={[
                  s.settingToggleText,
                  showTopTitleProgress !== false && s.settingToggleTextActive,
                ]}
              >
                {showTopTitleProgress !== false ? t("settings.enabled") : t("settings.disabled")}
              </Text>
            </TouchableOpacity>
          </View>
          {/* Частота врезок «нарисовать сцену» */}
          <SceneFrequencyRow styles={s} />
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Частота врезок «нарисовать сцену»: страниц между предложениями, 0 — выкл */
function SceneFrequencyRow({ styles: s }: { styles: ReturnType<typeof makeStyles> }) {
  const { t } = useTranslation();
  const interval = useNarraStore((st) => st.sceneSuggestionInterval);
  const setInterval = useNarraStore((st) => st.setSceneSuggestionInterval);

  return (
    <View style={[s.settingRow, { flexDirection: "column", alignItems: "stretch", gap: 10 }]}>
      <View>
        <Text style={s.settingLabel}>{t("narra.sceneFrequencyTitle", "Частота врезок")}</Text>
        <Text style={[s.settingLabel, { fontSize: 11, opacity: 0.6, marginTop: 2 }]}>
          {t("narra.sceneFrequencyDesc", "Как часто предлагать нарисовать сцену")}
        </Text>
      </View>
      <View style={s.viewModeRow}>
        {SCENE_SUGGESTION_INTERVALS.map((value) => (
          <TouchableOpacity
            key={value}
            style={[s.viewModeBtn, interval === value && s.viewModeBtnActive]}
            onPress={() => setInterval(value)}
          >
            <Text style={[s.viewModeBtnText, interval === value && s.viewModeBtnTextActive]}>
              {value > 0
                ? t("narra.sceneFrequencyPages", "{{count}} стр.", { count: value })
                : t("narra.sceneFrequencyOff", "Выкл")}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
