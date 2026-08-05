/**
 * ReaderSettingsPanel — bottom-sheet modal for reading display settings.
 */
import { XIcon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { SCENE_SUGGESTION_INTERVALS } from "@/lib/narra/scene-suggestion";
import { READER_PAGE_THEMES } from "@/lib/reader/reader-themes";
import { useNarraStore } from "@/stores";
import { useColors } from "@/styles/theme";
import { useFontStore } from "@readany/core/stores";
import { type RubyMode, useRubyStore } from "@readany/core/stores/ruby-store";
import type { ReadSettings } from "@readany/core/types";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles } from "./reader-styles";

interface Props {
  visible: boolean;
  readSettings: ReadSettings;
  bookId?: string;
  onClose: () => void;
  onUpdateSetting: <K extends keyof ReadSettings>(key: K, value: ReadSettings[K]) => void;
  onRubyModeChange?: (mode: RubyMode) => void;
}

export function ReaderSettingsPanel({
  visible,
  readSettings,
  bookId,
  onClose,
  onUpdateSetting,
  onRubyModeChange,
}: Props) {
  const colors = useColors();
  const s = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const { t } = useTranslation();

  const customFonts = useFontStore((s) => s.fonts);
  const selectedFontId = useFontStore((s) => s.selectedFontId);
  const setSelectedFont = useFontStore((s) => s.setSelectedFont);

  const {
    fontSize: settingFontSize,
    lineHeight: settingLineHeight,
    paragraphSpacing: settingParagraphSpacing,
    pageMargin: settingPageMargin,
    viewMode: settingViewMode,
    volumeButtonsPageTurn,
    showTopTitleProgress,
    followSystemFontScale,
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
                const bg = preset.preview?.bg ?? colors.background;
                const ink = preset.preview?.ink ?? colors.foreground;
                return (
                  <TouchableOpacity
                    key={preset.id}
                    style={[
                      s.pageThemeTile,
                      { backgroundColor: bg },
                      active && s.pageThemeTileActive,
                    ]}
                    onPress={() => onUpdateSetting("readerTheme", preset.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[s.pageThemeTileAa, { color: ink }]}>Aa</Text>
                    <Text style={[s.pageThemeTileLabel, { color: ink }]}>
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
          {/* Font */}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("fonts.title", "字体")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.themeScroll}>
              <View style={s.themeRow}>
                <TouchableOpacity
                  style={[s.themeBtn, !selectedFontId && s.themeBtnActive]}
                  onPress={() => setSelectedFont(null)}
                >
                  <Text style={[s.themeBtnText, !selectedFontId && s.themeBtnTextActive]}>
                    {t("fonts.sbSerif", "SB Serif")}
                  </Text>
                </TouchableOpacity>
                {customFonts.map((font) => (
                  <TouchableOpacity
                    key={font.id}
                    style={[s.themeBtn, selectedFontId === font.id && s.themeBtnActive]}
                    onPress={() => setSelectedFont(font.id)}
                  >
                    <Text
                      style={[s.themeBtnText, selectedFontId === font.id && s.themeBtnTextActive]}
                    >
                      {font.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
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
          <View style={s.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.settingLabel}>
                {t("settings.followSystemFontScale", "跟随系统字号")}
              </Text>
              <Text style={[s.settingLabel, { fontSize: 11, opacity: 0.6, marginTop: 2 }]}>
                {t("settings.followSystemFontScaleDesc", "按系统辅助功能字号自动放大")}
              </Text>
            </View>
            <TouchableOpacity
              style={[s.settingToggleBtn, !!followSystemFontScale && s.settingToggleBtnActive]}
              onPress={() => onUpdateSetting("followSystemFontScale", !followSystemFontScale)}
            >
              <Text
                style={[s.settingToggleText, !!followSystemFontScale && s.settingToggleTextActive]}
              >
                {followSystemFontScale ? t("settings.enabled") : t("settings.disabled")}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Частота врезок «нарисовать сцену» */}
          <SceneFrequencyRow styles={s} />

          {/* Ruby Annotation */}
          {bookId && (
            <RubySettingsRow
              bookId={bookId}
              colors={colors}
              styles={s}
              onModeChange={onRubyModeChange}
            />
          )}
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

/** Ruby annotation settings row */
function RubySettingsRow({
  bookId,
  colors,
  styles: s,
  onModeChange,
}: {
  bookId: string;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
  onModeChange?: (mode: RubyMode) => void;
}) {
  const { t } = useTranslation();
  const dictStatus = useRubyStore((st) => st.dictStates.zh.status);
  const dictProgress = useRubyStore((st) => st.dictStates.zh.progress);
  const currentMode = useRubyStore((st) => st.bookRubySettings[bookId] ?? null);
  const setBookRuby = useRubyStore((st) => st.setBookRuby);
  const [downloading, setDownloading] = useState(false);

  const zhReady = dictStatus === "ready";

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const { downloadChineseDictMobile } = await import("@/lib/ruby/dict-service-mobile");
      await downloadChineseDictMobile();
    } catch (err) {
      console.error("[Ruby] Download failed:", err);
    } finally {
      setDownloading(false);
    }
  }, []);

  const handleDelete = useCallback(async () => {
    try {
      const { deleteChineseDictMobile } = await import("@/lib/ruby/dict-service-mobile");
      await deleteChineseDictMobile();
    } catch (err) {
      console.error("[Ruby] Delete failed:", err);
    }
  }, []);

  const handleModeChange = useCallback(
    (mode: RubyMode) => {
      setBookRuby(bookId, mode);
      onModeChange?.(mode);
    },
    [bookId, setBookRuby, onModeChange],
  );

  const modes: Array<{ value: RubyMode; label: string }> = [
    { value: null, label: t("ruby.off", "关闭") },
    { value: "zh-pinyin", label: t("ruby.pinyin", "拼音") },
    { value: "zh-zhuyin", label: t("ruby.zhuyin", "注音") },
  ];

  return (
    <View style={[s.settingRow, { flexDirection: "column", alignItems: "stretch", gap: 10 }]}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.settingLabel}>{t("ruby.title", "注音")}</Text>
          <Text style={[s.settingLabel, { fontSize: 11, opacity: 0.6, marginTop: 2 }]}>
            {t("ruby.desc", "在汉字上方显示拼音读音")}
          </Text>
        </View>
        {!zhReady ? (
          <TouchableOpacity
            style={[s.settingToggleBtn, s.settingToggleBtnActive]}
            disabled={downloading || dictStatus === "downloading"}
            onPress={handleDownload}
          >
            {downloading || dictStatus === "downloading" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <ActivityIndicator size="small" color={colors.primaryForeground} />
                <Text style={s.settingToggleTextActive}>
                  {dictProgress ? `${dictProgress}%` : "..."}
                </Text>
              </View>
            ) : (
              <Text style={s.settingToggleTextActive}>{t("ruby.download", "下载")}</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.settingToggleBtn} onPress={handleDelete}>
            <Text style={s.settingToggleText}>{t("common.delete", "删除")}</Text>
          </TouchableOpacity>
        )}
      </View>
      {zhReady && (
        <View style={s.viewModeRow}>
          {modes.map((m) => (
            <TouchableOpacity
              key={m.value ?? "off"}
              style={[s.viewModeBtn, currentMode === m.value && s.viewModeBtnActive]}
              onPress={() => handleModeChange(m.value)}
            >
              <Text style={[s.viewModeBtnText, currentMode === m.value && s.viewModeBtnTextActive]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}
