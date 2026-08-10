import {
  BookmarkFilledIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HeadphonesIcon,
  LanguagesIcon,
  ListIcon,
  MessageSquareIcon,
  MoreVerticalIcon,
  NotebookPenIcon,
  PauseIcon,
  SearchIcon,
  TypeIcon,
  XIcon,
} from "@/components/ui/Icon";
import { Text as InterfaceText } from "@/components/ui/Typography";
import { getReaderBookmarkCopy } from "@/lib/reader/reader-bookmark-copy";
import { interfaceFontFamily, serifTextFontFamily } from "@deslop/primitives/native";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const READER_PREVIEW_STATES = [
  "reading",
  "controls",
  "bookmarked",
  "bookmark-added",
  "search-idle",
  "search-results",
  "search-empty",
  "selection",
  "selection-note",
  "toc",
  "bookmarks",
  "bookmarks-empty",
  "notebook",
  "notebook-empty",
  "settings",
  "translation",
  "translation-loading",
  "tts",
  "loading",
  "missing-book",
  "error",
] as const;

export type ReaderPreviewState = (typeof READER_PREVIEW_STATES)[number];
export type ReaderPreviewTheme = "light" | "sepia" | "dark";

interface ReaderInterfacePreviewProps {
  state?: ReaderPreviewState;
  readerTheme?: ReaderPreviewTheme;
  fontSize?: number;
}

const THEMES = {
  light: {
    background: "#F7F7F5",
    foreground: "#171717",
    muted: "#8B8B8B",
    surface: "#FFFFFF",
    overlay: "rgba(247, 247, 245, 0.92)",
    border: "rgba(23, 23, 23, 0.12)",
    accent: "#FF8200",
  },
  sepia: {
    background: "#F4ECD8",
    foreground: "#312A20",
    muted: "#877B6A",
    surface: "#FBF4E3",
    overlay: "rgba(244, 236, 216, 0.94)",
    border: "rgba(49, 42, 32, 0.14)",
    accent: "#C36A20",
  },
  dark: {
    background: "#151515",
    foreground: "#F1EEE8",
    muted: "#96928C",
    surface: "#252525",
    overlay: "rgba(21, 21, 21, 0.94)",
    border: "rgba(255, 255, 255, 0.14)",
    accent: "#FF900F",
  },
} as const;

const CHAPTERS = [
  ["Пролог", "1"],
  ["Глава 1. Возвращение", "8"],
  ["Глава 2. Письмо", "27"],
  ["Глава 3. Северный поезд", "46"],
] as const;

function IconButton({ children, surface }: { children: React.ReactNode; surface: string }) {
  return <View style={[styles.iconButton, { backgroundColor: surface }]}>{children}</View>;
}

export function ReaderInterfacePreview({
  state = "reading",
  readerTheme = "light",
  fontSize = 21,
}: ReaderInterfacePreviewProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const colors = THEMES[readerTheme];
  const sheetHeight = Math.min(height * 0.58, 470);
  const bookmarkCopy = useMemo(() => getReaderBookmarkCopy(t), [t]);
  const interfaceStrings = useMemo(
    () => ({
      search: t("reader.searchInBook", "Поиск по книге"),
      notebook: t("reader.notebook", "Блокнот"),
      notebookHint: t(
        "reader.notebookHint",
        "Выделяйте текст во время чтения, чтобы создавать заметки и выделения.",
      ),
      bookmarks: t("bookmarks.title", "Закладки"),
      bookmarksEmpty: t("bookmarks.empty", "Закладок пока нет"),
      addNote: t("reader.addNote", "Добавить заметку"),
    }),
    [t],
  );

  const hasPanel = [
    "toc",
    "bookmarks",
    "bookmarks-empty",
    "notebook",
    "notebook-empty",
    "settings",
    "translation",
    "translation-loading",
  ].includes(state);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.page}>
        <View style={[styles.topInfo, { top: Math.max(insets.top, 16) + 8 }]}>
          <InterfaceText style={[styles.topInfoText, { color: colors.muted }]}>
            Пролог
          </InterfaceText>
          <InterfaceText style={[styles.topInfoText, styles.tabular, { color: colors.muted }]}>
            1/5
          </InterfaceText>
        </View>

        <ScrollView
          scrollEnabled={false}
          contentContainerStyle={[
            styles.bookContent,
            { paddingTop: Math.max(insets.top, 16) + 108, paddingBottom: 120 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Text
            style={[
              styles.chapterTitle,
              {
                color: colors.foreground,
                fontFamily: serifTextFontFamily.bold,
                fontSize: fontSize + 4,
              },
            ]}
          >
            Пролог
          </Text>
          <Text
            style={[
              styles.readerText,
              {
                color: colors.foreground,
                fontFamily: serifTextFontFamily.regular,
                fontSize,
                lineHeight: fontSize * 1.58,
              },
            ]}
          >
            Гермиона очнулась несколько секунд назад и теперь смотрела на белоснежный потолок, не
            моргая. Ей казалось, что он начинает двигаться — движется прямо на неё, желая придавить.
          </Text>
          <Text
            style={[
              styles.readerText,
              {
                color: colors.foreground,
                fontFamily: serifTextFontFamily.regular,
                fontSize,
                lineHeight: fontSize * 1.58,
              },
            ]}
          >
            — Гермиона… Она сделала глубокий вдох и повернула голову, прикрывая глаза. Комната
            постепенно становилась знакомой.
          </Text>
          <Text
            style={[
              styles.readerText,
              {
                color: colors.foreground,
                fontFamily: serifTextFontFamily.regular,
                fontSize,
                lineHeight: fontSize * 1.58,
              },
            ]}
          >
            Только теперь она услышала дождь за окном и тихий шорох страниц на соседней кровати.
          </Text>
        </ScrollView>

        {(state === "selection" || state === "selection-note") && (
          <View style={styles.selectionHighlight} />
        )}
      </View>

      {state === "bookmarked" && (
        <View style={[styles.bookmarkRibbon, { top: Math.max(insets.top, 14) }]}>
          <View style={[styles.ribbonBody, { backgroundColor: colors.accent }]} />
          <View
            style={[
              styles.ribbonCutout,
              { borderLeftColor: colors.accent, borderRightColor: colors.accent },
            ]}
          />
        </View>
      )}

      {state === "bookmark-added" && (
        <View style={[styles.pullPromptWrap, { top: Math.max(insets.top, 12) + 66 }]}>
          <View style={styles.pullPrompt}>
            <InterfaceText style={styles.pullPromptText}>{bookmarkCopy.added}</InterfaceText>
          </View>
        </View>
      )}

      {state === "controls" && (
        <>
          <View
            style={[
              styles.controlsHeader,
              {
                paddingTop: Math.max(insets.top, 12),
                backgroundColor: colors.overlay,
                borderColor: colors.border,
              },
            ]}
          >
            <IconButton surface={colors.surface}>
              <ChevronLeftIcon size={22} color={colors.foreground} />
            </IconButton>
            <View style={styles.controlsHeaderActions}>
              <IconButton surface={colors.surface}>
                <ListIcon size={21} color={colors.foreground} />
              </IconButton>
              <IconButton surface={colors.surface}>
                <MoreVerticalIcon size={21} color={colors.foreground} />
              </IconButton>
            </View>
          </View>
          <View
            style={[
              styles.progressDock,
              {
                paddingBottom: Math.max(insets.bottom, 10),
                backgroundColor: colors.overlay,
                borderColor: colors.border,
              },
            ]}
          >
            <InterfaceText style={[styles.progressLabel, styles.tabular, { color: colors.muted }]}>
              18%
            </InterfaceText>
            <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
              <View style={[styles.progressFill, { backgroundColor: colors.accent }]} />
            </View>
          </View>
        </>
      )}

      {(state === "search-idle" || state === "search-results" || state === "search-empty") && (
        <View
          style={[
            styles.searchBar,
            {
              paddingTop: Math.max(insets.top, 12),
              backgroundColor: colors.overlay,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={[styles.searchField, { backgroundColor: colors.surface }]}>
            <SearchIcon size={18} color={colors.muted} />
            <InterfaceText
              style={[
                styles.searchText,
                { color: state === "search-idle" ? colors.muted : colors.foreground },
              ]}
            >
              {state === "search-idle" ? interfaceStrings.search : "Гермиона"}
            </InterfaceText>
          </View>
          {state !== "search-idle" && (
            <InterfaceText style={[styles.searchCount, styles.tabular, { color: colors.muted }]}>
              {state === "search-results" ? "1 / 12" : "0"}
            </InterfaceText>
          )}
          <ChevronLeftIcon
            size={20}
            color={state === "search-results" ? colors.foreground : colors.muted}
          />
          <ChevronRightIcon
            size={20}
            color={state === "search-results" ? colors.foreground : colors.muted}
          />
          <XIcon size={20} color={colors.muted} />
        </View>
      )}

      {state === "selection" && (
        <View
          style={[
            styles.selectionToolbar,
            { top: Math.max(insets.top, 16) + 202, backgroundColor: colors.surface },
          ]}
        >
          {["#FACC15", "#4ADE80", "#60A5FA", "#EC4899", "#A78BFA"].map((color) => (
            <View key={color} style={[styles.colorDot, { backgroundColor: color }]} />
          ))}
          <View style={[styles.selectionDivider, { backgroundColor: colors.border }]} />
          <NotebookPenIcon size={18} color={colors.foreground} />
          <LanguagesIcon size={18} color={colors.foreground} />
          <MessageSquareIcon size={18} color={colors.foreground} />
        </View>
      )}

      {state === "selection-note" && (
        <>
          <View style={styles.backdrop} />
          <View
            style={[
              styles.noteSheet,
              {
                paddingBottom: Math.max(insets.bottom, 16),
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <InterfaceText style={[styles.sheetTitle, { color: colors.foreground }]}>
                {interfaceStrings.addNote}
              </InterfaceText>
              <XIcon size={20} color={colors.muted} />
            </View>
            <InterfaceText
              style={[styles.quote, { color: colors.muted, borderColor: colors.accent }]}
            >
              «Ей казалось, что потолок начинает двигаться…»
            </InterfaceText>
            <View
              style={[
                styles.noteInput,
                { backgroundColor: colors.background, borderColor: colors.border },
              ]}
            >
              <InterfaceText style={{ color: colors.muted }}>Что хотите запомнить?</InterfaceText>
            </View>
            <View style={styles.noteActions}>
              <InterfaceText style={[styles.secondaryAction, { color: colors.foreground }]}>
                Отмена
              </InterfaceText>
              <View style={[styles.primaryAction, { backgroundColor: colors.accent }]}>
                <InterfaceText style={styles.primaryActionText}>Сохранить</InterfaceText>
              </View>
            </View>
          </View>
        </>
      )}

      {hasPanel && <View style={styles.backdrop} />}

      {(state === "toc" || state === "bookmarks" || state === "bookmarks-empty") && (
        <View
          style={[
            styles.bottomSheet,
            {
              height: sheetHeight,
              paddingBottom: Math.max(insets.bottom, 16),
              backgroundColor: colors.surface,
            },
          ]}
        >
          <View style={[styles.segmented, { backgroundColor: colors.background }]}>
            <View style={[styles.segment, state === "toc" && { backgroundColor: colors.surface }]}>
              <InterfaceText style={[styles.segmentText, { color: colors.foreground }]}>
                Оглавление
              </InterfaceText>
            </View>
            <View style={[styles.segment, state !== "toc" && { backgroundColor: colors.surface }]}>
              <InterfaceText style={[styles.segmentText, { color: colors.foreground }]}>
                {interfaceStrings.bookmarks}
              </InterfaceText>
            </View>
          </View>
          {state === "toc" ? (
            <View style={styles.list}>
              {CHAPTERS.map(([title, page], index) => (
                <View key={title} style={[styles.listRow, { borderColor: colors.border }]}>
                  <InterfaceText
                    style={[
                      styles.listTitle,
                      index === 0 && { color: colors.accent },
                      index !== 0 && { color: colors.foreground },
                    ]}
                  >
                    {title}
                  </InterfaceText>
                  <InterfaceText style={[styles.listMeta, styles.tabular, { color: colors.muted }]}>
                    {page}
                  </InterfaceText>
                </View>
              ))}
            </View>
          ) : state === "bookmarks" ? (
            <View style={styles.list}>
              <View style={[styles.bookmarkRow, { borderColor: colors.border }]}>
                <BookmarkFilledIcon size={20} color={colors.accent} />
                <View style={{ flex: 1, gap: 3 }}>
                  <InterfaceText style={[styles.listTitle, { color: colors.foreground }]}>
                    Пролог
                  </InterfaceText>
                  <InterfaceText
                    style={[styles.listMeta, { color: colors.muted }]}
                    numberOfLines={2}
                  >
                    Гермиона очнулась несколько секунд назад…
                  </InterfaceText>
                </View>
                <InterfaceText style={[styles.listMeta, { color: colors.muted }]}>
                  1 стр.
                </InterfaceText>
              </View>
            </View>
          ) : (
            <EmptyPanel
              title={interfaceStrings.bookmarksEmpty}
              hint="Добавьте закладку через меню читалки"
              colors={colors}
            />
          )}
        </View>
      )}

      {(state === "notebook" || state === "notebook-empty") && (
        <View
          style={[
            styles.bottomSheet,
            {
              height: sheetHeight,
              paddingBottom: Math.max(insets.bottom, 16),
              backgroundColor: colors.surface,
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <InterfaceText style={[styles.sheetTitle, { color: colors.foreground }]}>
              {interfaceStrings.notebook}
            </InterfaceText>
            <XIcon size={20} color={colors.muted} />
          </View>
          {state === "notebook" ? (
            <View style={styles.list}>
              <View style={[styles.noteCard, { backgroundColor: colors.background }]}>
                <View style={styles.noteCardHeader}>
                  <View style={[styles.noteMarker, { backgroundColor: "#FACC15" }]} />
                  <InterfaceText style={[styles.listMeta, { color: colors.muted }]}>
                    Пролог
                  </InterfaceText>
                </View>
                <InterfaceText
                  style={[styles.listTitle, { color: colors.foreground }]}
                  numberOfLines={3}
                >
                  Ей казалось, что потолок начинает двигаться — движется прямо на неё.
                </InterfaceText>
                <InterfaceText style={[styles.noteBody, { color: colors.muted }]}>
                  Первое пробуждение героини после переломного события.
                </InterfaceText>
              </View>
            </View>
          ) : (
            <EmptyPanel
              title="Заметок пока нет"
              hint={interfaceStrings.notebookHint}
              colors={colors}
            />
          )}
        </View>
      )}

      {state === "settings" && (
        <View
          style={[
            styles.bottomSheet,
            {
              height: sheetHeight,
              paddingBottom: Math.max(insets.bottom, 16),
              backgroundColor: colors.surface,
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <InterfaceText style={[styles.sheetTitle, { color: colors.foreground }]}>
              Оформление
            </InterfaceText>
            <XIcon size={20} color={colors.muted} />
          </View>
          <View style={styles.settingsGroup}>
            <InterfaceText style={[styles.settingLabel, { color: colors.muted }]}>
              Шрифт
            </InterfaceText>
            <View style={[styles.settingRow, { borderColor: colors.border }]}>
              <TypeIcon size={20} color={colors.foreground} />
              <InterfaceText style={[styles.listTitle, { color: colors.foreground }]}>
                SB Serif
              </InterfaceText>
              <InterfaceText style={[styles.listMeta, { color: colors.muted }]}>21</InterfaceText>
            </View>
            <InterfaceText style={[styles.settingLabel, { color: colors.muted }]}>
              Тема
            </InterfaceText>
            <View style={styles.themeRow}>
              {Object.entries(THEMES).map(([key, value]) => (
                <View
                  key={key}
                  style={[
                    styles.themeSwatch,
                    {
                      backgroundColor: value.background,
                      borderColor: key === readerTheme ? colors.accent : colors.border,
                    },
                  ]}
                />
              ))}
            </View>
            <InterfaceText style={[styles.settingLabel, { color: colors.muted }]}>
              Интервал и поля
            </InterfaceText>
            <View style={[styles.fakeSlider, { backgroundColor: colors.border }]}>
              <View style={[styles.fakeSliderFill, { backgroundColor: colors.accent }]} />
              <View style={[styles.fakeSliderThumb, { backgroundColor: colors.accent }]} />
            </View>
          </View>
        </View>
      )}

      {(state === "translation" || state === "translation-loading") && (
        <View
          style={[
            styles.bottomSheet,
            {
              height: Math.min(sheetHeight, 360),
              paddingBottom: Math.max(insets.bottom, 16),
              backgroundColor: colors.surface,
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <LanguagesIcon size={20} color={colors.accent} />
              <InterfaceText style={[styles.sheetTitle, { color: colors.foreground }]}>
                Перевод
              </InterfaceText>
            </View>
            <XIcon size={20} color={colors.muted} />
          </View>
          <InterfaceText
            style={[styles.quote, { color: colors.muted, borderColor: colors.border }]}
          >
            The room slowly became familiar again.
          </InterfaceText>
          {state === "translation-loading" ? (
            <View style={styles.loadingInline}>
              <ActivityIndicator color={colors.accent} />
              <InterfaceText style={[styles.listMeta, { color: colors.muted }]}>
                Переводим фрагмент…
              </InterfaceText>
            </View>
          ) : (
            <InterfaceText style={[styles.translationText, { color: colors.foreground }]}>
              Комната постепенно снова становилась знакомой.
            </InterfaceText>
          )}
        </View>
      )}

      {state === "tts" && (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.ttsPage,
            {
              backgroundColor: colors.background,
              paddingTop: Math.max(insets.top, 20) + 24,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View style={styles.ttsHeader}>
            <ChevronLeftIcon size={24} color={colors.foreground} />
            <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
              <InterfaceText style={[styles.ttsTitle, { color: colors.foreground }]}>
                Мера рациональности
              </InterfaceText>
              <InterfaceText style={[styles.listMeta, { color: colors.muted }]}>
                Пролог
              </InterfaceText>
            </View>
            <MoreVerticalIcon size={24} color={colors.foreground} />
          </View>
          <View style={[styles.ttsCover, { backgroundColor: colors.surface }]}>
            <HeadphonesIcon size={54} color={colors.accent} />
          </View>
          <View style={{ gap: 12 }}>
            <InterfaceText style={[styles.ttsKicker, { color: colors.accent }]}>
              СЕЙЧАС ЗВУЧИТ
            </InterfaceText>
            <Text
              style={[
                styles.ttsExcerpt,
                { color: colors.foreground, fontFamily: serifTextFontFamily.regular },
              ]}
            >
              Гермиона очнулась несколько секунд назад и теперь смотрела на белоснежный потолок…
            </Text>
          </View>
          <View style={styles.ttsControls}>
            <ChevronLeftIcon size={28} color={colors.foreground} />
            <View style={[styles.playButton, { backgroundColor: colors.accent }]}>
              <PauseIcon size={28} color="#FFFFFF" />
            </View>
            <ChevronRightIcon size={28} color={colors.foreground} />
          </View>
        </View>
      )}

      {state === "loading" && (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.centerState,
            { backgroundColor: colors.background },
          ]}
        >
          <ActivityIndicator size="large" color={colors.accent} />
          <InterfaceText style={[styles.centerTitle, { color: colors.foreground }]}>
            Открываем книгу…
          </InterfaceText>
        </View>
      )}

      {(state === "missing-book" || state === "error") && (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.centerState,
            { backgroundColor: colors.background },
          ]}
        >
          <View style={[styles.errorIcon, { backgroundColor: colors.surface }]}>
            {state === "missing-book" ? (
              <SearchIcon size={34} color={colors.muted} />
            ) : (
              <XIcon size={34} color="#D74747" />
            )}
          </View>
          <InterfaceText style={[styles.centerTitle, { color: colors.foreground }]}>
            {state === "missing-book" ? "Файл книги не найден" : "Не удалось открыть книгу"}
          </InterfaceText>
          <InterfaceText style={[styles.centerHint, { color: colors.muted }]}>
            {state === "missing-book"
              ? "Выберите исходный файл ещё раз. Заметки и прогресс сохранятся."
              : "Проверьте файл или попробуйте открыть книгу повторно."}
          </InterfaceText>
          <View style={[styles.primaryAction, { backgroundColor: colors.accent }]}>
            <InterfaceText style={styles.primaryActionText}>
              {state === "missing-book" ? "Выбрать файл" : "Повторить"}
            </InterfaceText>
          </View>
        </View>
      )}
    </View>
  );
}

function EmptyPanel({
  title,
  hint,
  colors,
}: {
  title: string;
  hint: string;
  colors: (typeof THEMES)[ReaderPreviewTheme];
}) {
  return (
    <View style={styles.emptyPanel}>
      <InterfaceText style={[styles.emptyTitle, { color: colors.foreground }]}>
        {title}
      </InterfaceText>
      <InterfaceText style={[styles.emptyHint, { color: colors.muted }]}>{hint}</InterfaceText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  page: { flex: 1 },
  topInfo: {
    position: "absolute",
    zIndex: 2,
    left: 24,
    right: 24,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  topInfoText: { fontSize: 13 },
  tabular: { fontVariant: ["tabular-nums"] },
  bookContent: { paddingHorizontal: 34, gap: 24 },
  chapterTitle: { fontWeight: "700" },
  readerText: { letterSpacing: 0.1 },
  selectionHighlight: {
    position: "absolute",
    left: 31,
    right: 40,
    top: 274,
    height: 34,
    borderRadius: 3,
    backgroundColor: "rgba(250, 204, 21, 0.38)",
  },
  bookmarkRibbon: { position: "absolute", zIndex: 15, right: 24, width: 18, height: 62 },
  ribbonBody: { width: 18, height: 52 },
  ribbonCutout: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 8,
    borderTopColor: "transparent",
    transform: [{ rotate: "180deg" }],
  },
  pullPromptWrap: { position: "absolute", zIndex: 30, left: 0, right: 0, alignItems: "center" },
  pullPrompt: {
    minHeight: 50,
    padding: 16,
    borderRadius: 999,
    backgroundColor: "rgba(17,17,17,0.6)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 10px 24px rgba(0,0,0,0.2)",
  },
  pullPromptText: { color: "#FFFFFF", fontSize: 13, fontFamily: interfaceFontFamily.regular },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderCurve: "continuous",
  },
  controlsHeader: {
    position: "absolute",
    zIndex: 24,
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  controlsHeaderActions: { flexDirection: "row", gap: 8 },
  progressDock: {
    position: "absolute",
    zIndex: 24,
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 16,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  progressLabel: { width: 34, textAlign: "right", fontSize: 12 },
  progressTrack: { flex: 1, height: 4, borderRadius: 999, overflow: "hidden" },
  progressFill: { width: "18%", height: "100%", borderRadius: 999 },
  searchBar: {
    position: "absolute",
    zIndex: 40,
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  searchField: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderCurve: "continuous",
  },
  searchText: { flex: 1, fontSize: 14 },
  searchCount: { fontSize: 12 },
  selectionToolbar: {
    position: "absolute",
    zIndex: 35,
    left: 18,
    right: 18,
    minHeight: 52,
    borderRadius: 16,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 7,
    borderCurve: "continuous",
    boxShadow: "0 8px 28px rgba(0,0,0,0.22)",
  },
  colorDot: { width: 24, height: 24, borderRadius: 999 },
  selectionDivider: { width: StyleSheet.hairlineWidth, height: 24 },
  backdrop: { ...StyleSheet.absoluteFill, zIndex: 45, backgroundColor: "rgba(0,0,0,0.32)" },
  noteSheet: {
    position: "absolute",
    zIndex: 50,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 18,
    gap: 16,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: "continuous",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  sheetTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetTitle: { fontSize: 20, fontFamily: interfaceFontFamily.semibold },
  quote: { borderLeftWidth: 3, paddingLeft: 12, fontSize: 14, lineHeight: 20 },
  noteInput: {
    minHeight: 110,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
    borderCurve: "continuous",
  },
  noteActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 12 },
  secondaryAction: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontFamily: interfaceFontFamily.semibold,
  },
  primaryAction: {
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryActionText: { color: "#FFFFFF", fontFamily: interfaceFontFamily.semibold },
  bottomSheet: {
    position: "absolute",
    zIndex: 50,
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    paddingTop: 14,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderCurve: "continuous",
  },
  segmented: {
    height: 42,
    borderRadius: 12,
    padding: 3,
    flexDirection: "row",
    gap: 3,
    borderCurve: "continuous",
  },
  segment: {
    flex: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderCurve: "continuous",
  },
  segmentText: { fontSize: 13, fontFamily: interfaceFontFamily.semibold },
  list: { paddingTop: 14 },
  listRow: {
    minHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  listTitle: { flex: 1, fontSize: 15, fontFamily: interfaceFontFamily.semibold },
  listMeta: { fontSize: 12, lineHeight: 17 },
  bookmarkRow: {
    minHeight: 82,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  emptyPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: { fontSize: 20, fontFamily: interfaceFontFamily.semibold, textAlign: "center" },
  emptyHint: { maxWidth: 300, fontSize: 14, lineHeight: 20, textAlign: "center" },
  noteCard: { borderRadius: 18, padding: 16, gap: 9, borderCurve: "continuous" },
  noteCardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  noteMarker: { width: 9, height: 9, borderRadius: 999 },
  noteBody: { fontSize: 13, lineHeight: 19 },
  settingsGroup: { paddingTop: 12, gap: 12 },
  settingLabel: { fontSize: 12, paddingTop: 4 },
  settingRow: {
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  themeRow: { flexDirection: "row", gap: 12 },
  themeSwatch: { width: 52, height: 52, borderRadius: 999, borderWidth: 3 },
  fakeSlider: { height: 4, borderRadius: 999, marginTop: 12 },
  fakeSliderFill: { width: "62%", height: 4, borderRadius: 999 },
  fakeSliderThumb: {
    position: "absolute",
    left: "58%",
    top: -6,
    width: 16,
    height: 16,
    borderRadius: 999,
  },
  loadingInline: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  translationText: { paddingTop: 18, fontSize: 18, lineHeight: 26 },
  ttsPage: { paddingHorizontal: 24, gap: 28 },
  ttsHeader: { flexDirection: "row", alignItems: "center" },
  ttsTitle: { fontSize: 15, fontFamily: interfaceFontFamily.semibold },
  ttsCover: {
    alignSelf: "center",
    width: 180,
    height: 230,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderCurve: "continuous",
    boxShadow: "0 14px 30px rgba(0,0,0,0.16)",
  },
  ttsKicker: { fontSize: 11, fontFamily: interfaceFontFamily.bold, letterSpacing: 1.2 },
  ttsExcerpt: { fontSize: 22, lineHeight: 32, textAlign: "center" },
  ttsControls: {
    marginTop: "auto",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 34,
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  centerState: { alignItems: "center", justifyContent: "center", paddingHorizontal: 34, gap: 14 },
  centerTitle: { fontSize: 21, fontFamily: interfaceFontFamily.semibold, textAlign: "center" },
  centerHint: { maxWidth: 320, fontSize: 14, lineHeight: 20, textAlign: "center" },
  errorIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    borderCurve: "continuous",
  },
});
