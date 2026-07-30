import { ProfileNumericText } from "@/components/profile/ProfileNumericText";
import {
  BarChart3Icon,
  ChevronRightIcon,
  CloudIcon,
  HelpCircleIcon,
  InfoIcon,
  Trash2Icon,
} from "@/components/ui/Icon";
import type { MaterialIconComponent } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { clearMobileRuntimeCache, formatCacheSize } from "@/lib/platform/mobile-cache";
import { stopTTSPreview } from "@/lib/platform/tts-preview";
import {
  mergeCurrentSessionIntoDailyStats,
  mergeCurrentSessionIntoOverallStats,
} from "@/lib/stats/live-reading-stats";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useReadingSessionStore, useTTSStore } from "@/stores";
import type { ThemeMode } from "@/styles/ThemeContext";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  useColors,
  useTheme,
  withOpacity,
} from "@/styles/theme";
import SegmentedControl from "@expo/ui/community/segmented-control";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { readingStatsService } from "@readany/core/stats";
import type { DailyStats, OverallStats } from "@readany/core/stats";
import { eventBus } from "@readany/core/utils/event-bus";
import Constants from "expo-constants";
/**
 * ProfileScreen — matching Tauri mobile ProfilePage exactly.
 * Features: reading stats cards, heatmap, settings menu (general/skills/about),
 * complete menu items including Skills and VectorModel.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ProfileMenuIcon = MaterialIconComponent;
type ProfileMenuRoute = Extract<keyof RootStackParamList, "SyncSettings" | "About">;
type ProfileMenuItem =
  | {
      icon: ProfileMenuIcon;
      label: string;
      route: ProfileMenuRoute;
      showDot?: boolean;
    }
  | {
      icon: ProfileMenuIcon;
      label: string;
      url: string;
    }
  | {
      icon: ProfileMenuIcon;
      label: string;
      action: () => void;
      disabled?: boolean;
    };

const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

function formatProfileReadingTime(minutes: number): string {
  const roundedMinutes = Math.max(0, Math.round(minutes));
  if (roundedMinutes < 60) return `${roundedMinutes}\u00a0мин`;

  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;
  return remainingMinutes > 0 ? `${hours}\u00a0ч ${remainingMinutes}\u00a0мин` : `${hours}\u00a0ч`;
}

function StatCard({
  title,
  value,
  onPress,
  style,
}: {
  title: string;
  value: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={[s.statCard, style]}>
      <View style={s.statCardTitleRow}>
        <Text style={s.statCardTitle} numberOfLines={1} maxFontSizeMultiplier={1.6}>
          {title}
        </Text>
      </View>
      <View style={s.statCardBody}>
        <ProfileNumericText value={value} color={colors.foreground} style={s.statCardValue} />
      </View>
    </TouchableOpacity>
  );
}

/** Compact heatmap — last 16 weeks, matching Tauri MobileHeatmap */
function MiniHeatmap({ dailyStats }: { dailyStats: DailyStats[] }) {
  const themeColors = useColors();
  const s = makeStyles(themeColors);
  const { t } = useTranslation();
  const WEEKS = 16;
  const DAYS_PER_WEEK = 7;
  const GAP = 2;
  const [containerWidth, setContainerWidth] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{
    date: string;
    time: number;
    x: number;
    y: number;
  } | null>(null);

  // Calculate cell size based on container width
  // containerWidth = WEEKS * CELL + (WEEKS - 1) * GAP
  const CELL = containerWidth > 0 ? Math.floor((containerWidth - (WEEKS - 1) * GAP) / WEEKS) : 8;
  const gridWidth = WEEKS * CELL + (WEEKS - 1) * GAP;
  const gridHeight = DAYS_PER_WEEK * CELL + (DAYS_PER_WEEK - 1) * GAP;

  const cells = useMemo(() => {
    const statsMap = new Map<string, number>();
    for (const d of dailyStats) statsMap.set(d.date, d.totalTime);

    const today = new Date();
    const result: { col: number; row: number; intensity: number; date: string; time: number }[] =
      [];
    const maxTime = Math.max(1, ...dailyStats.map((d) => d.totalTime));

    for (let w = WEEKS - 1; w >= 0; w--) {
      for (let d = 0; d < DAYS_PER_WEEK; d++) {
        const date = new Date(today);
        date.setDate(today.getDate() - (w * 7 + (6 - d)));
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const time = statsMap.get(key) || 0;
        result.push({
          col: WEEKS - 1 - w,
          row: d,
          intensity: time > 0 ? Math.min(1, time / maxTime) : 0,
          date: key,
          time,
        });
      }
    }
    return result;
  }, [dailyStats]);

  const getColor = (intensity: number) => {
    if (intensity <= 0) return themeColors.muted;
    if (intensity < 0.25) return withOpacity(themeColors.primary, 0.3);
    if (intensity < 0.5) return withOpacity(themeColors.primary, 0.5);
    if (intensity < 0.75) return withOpacity(themeColors.primary, 0.7);
    return withOpacity(themeColors.primary, 0.9);
  };

  const formatDisplayDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}${t("common.minutes", "分钟")}`;
    return `${(minutes / 60).toFixed(1)}${t("common.hours", "小时")}`;
  };

  const handleCellPress = (cell: { date: string; time: number }, col: number, row: number) => {
    const x = col * (CELL + GAP) + CELL / 2;
    const y = row * (CELL + GAP) + CELL / 2;
    if (selectedCell?.date === cell.date) {
      setSelectedCell(null);
    } else {
      setSelectedCell({ ...cell, x, y });
      setTimeout(() => setSelectedCell(null), 1000);
    }
  };

  // Calculate tooltip position with boundary detection
  const getTooltipStyle = () => {
    if (!selectedCell || containerWidth === 0) return null;
    const TOOLTIP_WIDTH = 80;
    const TOOLTIP_HEIGHT = 24;

    let left = selectedCell.x - TOOLTIP_WIDTH / 2;
    let top = selectedCell.y - TOOLTIP_HEIGHT - 8;

    // Boundary detection
    if (left < 4) left = 4;
    if (left + TOOLTIP_WIDTH > containerWidth - 4) left = containerWidth - TOOLTIP_WIDTH - 4;
    if (top < 4) top = selectedCell.y + CELL + 4; // Show below if no space above

    return { left, top };
  };

  const tooltipStyle = getTooltipStyle();

  return (
    <View
      style={s.heatmapContainer}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {containerWidth > 0 && (
        <View style={[s.heatmapGrid, { width: gridWidth, height: gridHeight }]}>
          {cells.map((cell) => (
            <TouchableOpacity
              key={cell.date}
              style={{
                position: "absolute",
                left: cell.col * (CELL + GAP),
                top: cell.row * (CELL + GAP),
                width: CELL,
                height: CELL,
                borderRadius: Math.max(2, CELL * 0.25),
                backgroundColor: getColor(cell.intensity),
              }}
              onPress={() => handleCellPress(cell, cell.col, cell.row)}
              activeOpacity={0.7}
            />
          ))}
        </View>
      )}
      {/* Selected cell tooltip */}
      {selectedCell && tooltipStyle && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            ...tooltipStyle,
            backgroundColor: themeColors.card,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 4,
            borderWidth: 0.5,
            borderColor: themeColors.border,
            minWidth: 80,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.15,
            shadowRadius: 2,
            elevation: 3,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              color: themeColors.cardForeground,
              fontWeight: "500",
              textAlign: "center",
            }}
          >
            {formatDisplayDate(selectedCell.date)}{" "}
            {selectedCell.time > 0 ? formatTime(selectedCell.time) : t("stats.noReading", "无阅读")}
          </Text>
        </View>
      )}
    </View>
  );
}

export function ProfileScreen() {
  const { colors, mode: themeMode, setMode: setThemeMode, isDark } = useTheme();
  const s = makeStyles(colors);
  const { t, i18n } = useTranslation();
  const layout = useResponsiveLayout();
  const statsGridColumns = layout.isTablet ? 4 : 2;
  const statCardSlotWidth = `${100 / statsGridColumns}%` as `${number}%`;
  const nav = useNavigation<Nav>();
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [clearingCache, setClearingCache] = useState(false);
  const saveCurrentSession = useReadingSessionStore((s) => s.saveCurrentSession);
  const currentSession = useReadingSessionStore((s) => s.currentSession);
  const stopTTS = useTTSStore((s) => s.stop);
  const themeLabels = [
    t("settings.system", "Системная"),
    t("settings.light", "Светлая"),
    t("settings.dark", "Тёмная"),
  ];
  const selectedThemeIndex = Math.max(0, THEME_MODES.indexOf(themeMode));

  const loadStats = useCallback(async () => {
    try {
      await saveCurrentSession();

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 365);

      const [daily, overallStats] = await Promise.all([
        readingStatsService.getDailyStats(startDate, endDate),
        readingStatsService.getOverallStats(),
      ]);
      setDailyStats(daily);
      setOverall(overallStats);
    } catch (err) {
      console.error("[ProfileScreen] Failed to load stats:", err);
    }
  }, [saveCurrentSession]);

  useFocusEffect(
    useCallback(() => {
      void loadStats();
    }, [loadStats]),
  );

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      void loadStats();
    });
  }, [loadStats]);

  const liveDailyStats = useMemo(
    () => mergeCurrentSessionIntoDailyStats(dailyStats, currentSession),
    [dailyStats, currentSession],
  );
  const liveOverall = useMemo(
    () => mergeCurrentSessionIntoOverallStats(overall, dailyStats, currentSession),
    [overall, dailyStats, currentSession],
  );
  const handleClearCache = useCallback(() => {
    Alert.alert(
      t("profile.clearCacheTitle", "清除缓存"),
      t(
        "profile.clearCacheConfirm",
        "将清除临时导入文件、TTS 音频缓存和其他运行缓存。书籍、笔记、设置和同步数据不会被删除。",
      ),
      [
        { text: t("common.cancel", "取消"), style: "cancel" },
        {
          text: t("profile.clearCacheAction", "清除缓存"),
          style: "destructive",
          onPress: async () => {
            setClearingCache(true);
            try {
              stopTTS();
              stopTTSPreview();
              const result = await clearMobileRuntimeCache();
              Alert.alert(
                t("profile.clearCacheDoneTitle", "缓存已清除"),
                t("profile.clearCacheDoneDesc", {
                  count: result.deletedFiles,
                  size: formatCacheSize(result.deletedBytes),
                }),
              );
            } catch (error) {
              console.error("[ProfileScreen] Failed to clear cache:", error);
              Alert.alert(
                t("profile.clearCacheFailedTitle", "清除失败"),
                error instanceof Error
                  ? error.message
                  : t("profile.clearCacheFailedDesc", "请稍后重试。"),
              );
            } finally {
              setClearingCache(false);
            }
          },
        },
      ],
    );
  }, [stopTTS, t]);

  // Settings menu — matching Tauri ProfilePage exactly
  const menuSections = useMemo<{ title: string; items: ProfileMenuItem[] }[]>(
    () => [
      {
        title: t("settings.general", "通用"),
        items: [
          { icon: CloudIcon, label: t("settings.sync", "同步"), route: "SyncSettings" as const },
        ],
      },
      {
        title: t("profile.storage", "存储"),
        items: [
          {
            icon: Trash2Icon,
            label: clearingCache
              ? t("profile.clearingCache", "清除中...")
              : t("profile.clearCache", "清除缓存"),
            action: handleClearCache,
            disabled: clearingCache,
          },
        ],
      },
      {
        title: t("settings.other", "更多"),
        items: [
          {
            icon: HelpCircleIcon,
            label: t("about.supportCenter", "帮助中心"),
            url: `https://codedogqby.github.io/ReadAny/${i18n.language === "zh" ? "zh/" : ""}support/`,
          },
          { icon: InfoIcon, label: t("settings.about", "关于"), route: "About" as const },
        ],
      },
    ],
    [t, i18n.language, clearingCache, handleClearCache],
  );

  const booksRead = liveOverall?.totalBooks ?? 0;
  const totalTime = formatProfileReadingTime(liveOverall?.totalReadingTime ?? 0);
  const totalCharacters = new Intl.NumberFormat("ru-RU").format(
    Math.max(0, Math.round(liveOverall?.totalCharactersRead ?? 0)),
  );
  const streak = liveOverall?.currentStreak ?? 0;
  const overviewCards = [
    {
      key: "time",
      title: t("profile.totalTime", "总时长"),
      value: totalTime,
    },
    {
      key: "volume",
      title: t("profile.readingVolume", "阅读字数"),
      value: totalCharacters,
    },
    {
      key: "books",
      title: t("profile.booksRead", "已读"),
      value: String(booksRead),
    },
    {
      key: "streak",
      title: t("profile.streak", "连续阅读"),
      value: String(streak),
    },
  ];

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={[]}>
      <ScrollView
        style={s.scrollView}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Stats cards */}
        <View style={s.statsSection}>
          <View style={s.statsGrid}>
            {overviewCards.map((card) => (
              <View
                key={card.key}
                style={{
                  width: statCardSlotWidth,
                  paddingHorizontal: 6,
                }}
              >
                <StatCard
                  title={card.title}
                  value={card.value}
                  onPress={() => nav.navigate("Stats")}
                  style={{ width: "100%" }}
                />
              </View>
            ))}
          </View>
        </View>

        {/* Compact heatmap */}
        <View style={s.heatmapSection}>
          <View style={s.heatmapHeader}>
            <Text style={s.heatmapTitle} numberOfLines={1} maxFontSizeMultiplier={1.5}>
              {t("profile.readingActivity", "阅读活动")}
            </Text>
            <TouchableOpacity style={s.heatmapDetailBtn} onPress={() => nav.navigate("Stats")}>
              <BarChart3Icon size={14} color={colors.primary} />
              <Text style={s.heatmapDetailText} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                {t("profile.viewDetails", "查看详情")}
              </Text>
            </TouchableOpacity>
          </View>
          <MiniHeatmap dailyStats={liveDailyStats} />
        </View>

        <View style={s.menuSection}>
          <Text style={s.menuSectionTitle} maxFontSizeMultiplier={1.5}>
            {t("settings.theme", "Тема")}
          </Text>
          <SegmentedControl
            values={themeLabels}
            selectedIndex={selectedThemeIndex}
            onChange={({ nativeEvent }) => {
              setThemeMode(THEME_MODES[nativeEvent.selectedSegmentIndex] ?? "system");
            }}
            appearance={isDark ? "dark" : "light"}
            tintColor={colors.primary5}
            style={s.themeControl}
          />
        </View>

        {/* Settings menu */}
        {menuSections.map((section) => (
          <View key={section.title} style={s.menuSection}>
            <Text style={s.menuSectionTitle} maxFontSizeMultiplier={1.5}>
              {section.title}
            </Text>
            <View style={s.menuCard}>
              {section.items.map((item, idx) => {
                const Icon = item.icon;
                const itemKey =
                  "route" in item ? item.route : "url" in item ? item.url : item.label;
                const handlePress = () => {
                  if ("disabled" in item && item.disabled) {
                    return;
                  }
                  if ("action" in item && item.action) {
                    item.action();
                  } else if ("url" in item && item.url) {
                    Linking.openURL(item.url);
                  } else if ("route" in item) {
                    nav.navigate(item.route);
                  }
                };
                return (
                  <Pressable
                    key={itemKey}
                    style={({ pressed }) => [
                      s.menuItem,
                      idx < section.items.length - 1 && s.menuItemBorder,
                      pressed && { backgroundColor: colors.primary5 },
                    ]}
                    onPress={handlePress}
                    disabled={"disabled" in item && item.disabled}
                    android_ripple={{ color: colors.primary5 }}
                    accessibilityRole="button"
                  >
                    <Icon size={20} color={colors.mutedForeground} />
                    <Text style={s.menuItemLabel} maxFontSizeMultiplier={1.7}>
                      {item.label}
                    </Text>
                    {"showDot" in item && item.showDot ? <View style={s.menuItemDot} /> : null}
                    <ChevronRightIcon size={16} color={colors.mutedForeground} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {/* Version */}
        <Text style={s.version} maxFontSizeMultiplier={1.4}>
          {t("profile.version", { version: Constants.expoConfig?.version ?? "1.0.0" })}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    headerTitleWrap: {
      flex: 1,
      minWidth: 0,
      marginRight: 12,
    },
    headerTitle: {
      fontSize: fontSize["2xl"],
      lineHeight: fontSize["2xl"] * 1.4,
      fontWeight: fontWeight.bold,
      color: colors.foreground,
    },
    scrollView: { flex: 1 },
    scrollContent: {
      paddingTop: 20,
      paddingBottom: 12,
      gap: spacing.xxl,
    },
    // Stats
    statsSection: { paddingHorizontal: 16, paddingTop: 16 },
    statsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: 12,
      marginHorizontal: -6,
    },
    statCard: {
      backgroundColor: colors.elevation1,
      borderRadius: radius.card,
      borderWidth: 0.5,
      borderColor: colors.primary5,
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 10,
      minHeight: 102,
    },
    statCardHeader: {
      marginBottom: 10,
    },
    statCardTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      minWidth: 0,
    },
    statCardTitle: {
      flex: 1,
      fontSize: 11,
      lineHeight: 16,
      fontWeight: fontWeight.medium,
      color: withOpacity(colors.mutedForeground, 0.8),
    },
    statCardBody: { flexDirection: "row", alignItems: "baseline", gap: 4 },
    statCardValue: {
      flexShrink: 1,
      fontSize: 25,
      lineHeight: 32,
      fontWeight: fontWeight.bold,
      color: colors.foreground,
      letterSpacing: -0.8,
    },
    statCardMetaRow: {
      marginTop: 6,
    },
    statCardMetaText: {
      fontSize: 11,
      lineHeight: 16,
      color: withOpacity(colors.mutedForeground, 0.72),
    },
    statCardMetaLabel: {
      color: withOpacity(colors.mutedForeground, 0.72),
    },
    statCardMetaDivider: {
      color: withOpacity(colors.mutedForeground, 0.46),
    },
    statCardMetaValue: {
      fontWeight: fontWeight.semibold,
      color: withOpacity(colors.foreground, 0.78),
    },
    // Heatmap
    heatmapSection: {
      marginHorizontal: 16,
      backgroundColor: colors.elevation1,
      borderRadius: radius.card,
      borderWidth: 0.5,
      borderColor: colors.primary5,
      padding: 16,
    },
    heatmapHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 12,
    },
    heatmapTitle: {
      flex: 1,
      minWidth: 0,
      fontSize: fontSize.sm,
      lineHeight: fontSize.sm * 1.5,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    heatmapDetailBtn: {
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    heatmapDetailText: {
      fontSize: fontSize.xs,
      lineHeight: fontSize.xs * 1.5,
      color: colors.primary,
    },
    heatmapContainer: { width: "100%" },
    heatmapGrid: { alignSelf: "center" },
    // Menu
    menuSection: { paddingHorizontal: 16 },
    themeControl: { width: "100%", minHeight: 36 },
    menuSectionTitle: {
      fontSize: fontSize.xs,
      lineHeight: fontSize.xs * 1.5,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    menuCard: {
      backgroundColor: colors.elevation1,
      borderRadius: radius.card,
      borderWidth: 0.5,
      borderColor: colors.primary5,
      overflow: "hidden",
    },
    menuItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    menuItemBorder: { borderBottomWidth: 0.5, borderBottomColor: colors.border },
    menuItemLabel: {
      flex: 1,
      fontSize: fontSize.md,
      lineHeight: fontSize.md * 1.5,
      color: colors.foreground,
    },
    menuItemDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.destructive,
    },
    version: {
      textAlign: "center",
      fontSize: fontSize.xs,
      lineHeight: fontSize.xs * 1.6,
      color: colors.mutedForeground,
      marginBottom: 2,
    },
  });
