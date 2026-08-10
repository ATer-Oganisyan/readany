import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { BookmarkRibbon } from "@/components/reader/BookmarkRibbon";
import { ChapterTranslationSheet } from "@/components/reader/ChapterTranslationSheet";
import { TTSPage } from "@/components/reader/TTSPage";
import { TranslationPanel } from "@/components/reader/TranslationPanel";
import { NotebookPenIcon, XIcon } from "@/components/ui/Icon";
import { NativeButton } from "@/components/ui/NativeButton";
import { NativeContextMenuButton } from "@/components/ui/NativeContextMenuButton";
import { Text } from "@/components/ui/Typography";
import { useReaderBridge } from "@/hooks/use-reader-bridge";
import type { RelocateEvent, SelectionEvent, VisibleTTSSegment } from "@/hooks/use-reader-bridge";
import { durationBucket } from "@/lib/analytics/contract";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import {
  BUNDLED_CATALOG_BOOKS,
  findBundledCatalogBookByTitle,
  installBundledCatalogCover,
  normalizeCatalogIdentity,
  resolveBundledCatalogBookUri,
} from "@/lib/catalog/bundled-books";
import { getBundledCatalogCharactersByTitle } from "@/lib/narra/bundled-catalog-characters";
import { buildCharacterNameMatcherSpec } from "@/lib/narra/character-name-matcher";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import { reportNarraError } from "@/lib/narra/errors";
import { normalizePersistedNarraMediaUri } from "@/lib/narra/media";
import { generateNarraSceneImage } from "@/lib/narra/scene-image-openrouter";
import {
  sceneImageDataUri,
  sceneInsertAnchors,
  sceneSourceKeyForAnchor,
} from "@/lib/narra/scene-inserts";
import {
  INITIAL_SCENE_SUGGESTION_STATE,
  advanceSceneSuggestion,
} from "@/lib/narra/scene-suggestion";
import type { NarraCharacter } from "@/lib/narra/types";
import {
  DEFAULT_READER_FONT_FAMILY,
  getBundledReaderFontFaceCSS,
  getBundledReaderFontFamily,
} from "@/lib/reader/bundled-reader-font";
import { startFileServer, stopFileServer } from "@/lib/reader/local-file-server";
import { getReaderBookmarkCopy } from "@/lib/reader/reader-bookmark-copy";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import {
  useAnnotationStore,
  useLibraryStore,
  useNarraStore,
  useReaderStore,
  useReadingSessionStore,
  useSettingsStore,
  useTTSStore,
} from "@/stores";
import { useMissingBookPromptStore } from "@/stores/missing-book-prompt-store";
import { useTheme } from "@/styles/ThemeContext";
import { useColors } from "@/styles/theme";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { readingContextService } from "@readany/core/ai/reading-context-service";
import { runWithDbRetry } from "@readany/core/db/write-retry";
import { useChapterTranslation } from "@readany/core/hooks";
import { useReadingSession } from "@readany/core/hooks/use-reading-session";
import { getPlatformService } from "@readany/core/services";
import { getCSSFontFace, useFontStore } from "@readany/core/stores";
import type { ReadSettings, TOCItem } from "@readany/core/types";
import { eventBus } from "@readany/core/utils/event-bus";
import { throttle } from "@readany/core/utils/throttle";
import { Asset } from "expo-asset";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
/**
 * ReaderScreen — WebView-based reader with foliate-js engine.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  type AppStateStatus,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

// ── Extracted modules ──
import { ReaderCharacterCard } from "./reader/ReaderCharacterCard";
import { ReaderNoteViewModal } from "./reader/ReaderNoteViewModal";
import { ReaderToolbar, TOOLBAR_HEIGHT } from "./reader/ReaderToolbar";

const REFLOWABLE_CHARACTERS_PER_LOCATION = 1500;
const MAX_TRACKED_LOCATION_DELTA = 20;
const MAX_TRACKED_PAGE_DELTA = 20;
const MAX_TRACKED_FRACTION_DELTA = 0.08;
const INITIAL_PROGRESS_RESTORE_GUARD_MS = 1800;
const PROGRAMMATIC_NAV_GUARD_MS = 1200;
const BOOK_MIME_TYPES = [
  "application/epub+zip",
  "application/pdf",
  "application/x-mobipocket-ebook",
  "application/vnd.amazon.ebook",
  "application/vnd.comicbook+zip",
  "application/x-fictionbook+xml",
  "text/plain",
  "application/octet-stream",
];

const BOOK_FORMAT_MIME_TYPES: Partial<Record<string, string>> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  mobi: "application/x-mobipocket-ebook",
  azw: "application/vnd.amazon.ebook",
  azw3: "application/vnd.amazon.ebook",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook+zip",
  fb2: "application/x-fictionbook+xml",
  fbz: "application/x-zip-compressed-fb2",
  txt: "text/plain",
};

function normalizeBookIdentityText(value?: string): string {
  return (value || "").toLowerCase().replace(/[\s\p{P}\p{S}_-]+/gu, "");
}

function authorsLikelyMatch(a?: string, b?: string): boolean {
  const left = normalizeBookIdentityText(a);
  const right = normalizeBookIdentityText(b);
  if (!left || !right) return true;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftParts = left.split(/[,，、/&]+/).filter((part) => part.length > 1);
  const rightParts = right.split(/[,，、/&]+/).filter((part) => part.length > 1);
  return leftParts.some((part) =>
    rightParts.some((candidate) => part.includes(candidate) || candidate.includes(part)),
  );
}

function shouldConfirmReimportCandidate(
  originalBook: { meta: { title: string; author: string }; format: string; fileHash?: string },
  candidate: { title: string; author: string; format: string; fileHash?: string },
): boolean {
  if (candidate.fileHash && originalBook.fileHash && candidate.fileHash === originalBook.fileHash) {
    return false;
  }
  const originalTitle = normalizeBookIdentityText(originalBook.meta.title);
  const candidateTitle = normalizeBookIdentityText(candidate.title);
  const titleMismatch =
    !!originalTitle &&
    !!candidateTitle &&
    originalTitle !== candidateTitle &&
    !originalTitle.includes(candidateTitle) &&
    !candidateTitle.includes(originalTitle);
  const authorMismatch = !authorsLikelyMatch(originalBook.meta.author, candidate.author);
  const formatMismatch = originalBook.format !== candidate.format;
  return titleMismatch || (formatMismatch && authorMismatch);
}
const NOTE_TOOLTIP_WIDTH = 300;
const NOTE_TOOLTIP_SIDE_PADDING = 12;
const NOTE_TOOLTIP_ABOVE_OFFSET = 2;
const NOTE_TOOLTIP_BELOW_OFFSET = 8;
const NOTE_TOOLTIP_TOP_THRESHOLD = 180;
import { resolveReaderThemeColors } from "@/lib/reader/reader-themes";
import { useRubyStore } from "@readany/core/stores/ruby-store";
import { ReaderSettingsPanel } from "./reader/ReaderSettingsPanel.entry";
import { type ReaderNavTab, ReaderTOCPanel } from "./reader/ReaderTOCPanel";
import { CONTROLS_TIMEOUT, SCREEN_HEIGHT, SCREEN_WIDTH } from "./reader/reader-constants";
import { makeStyles, noteTooltipMdStyles } from "./reader/reader-styles";
import { useReaderBookmark } from "./reader/useReaderBookmark";
import { useReaderSearch } from "./reader/useReaderSearch";
import { useReaderSystemInfo } from "./reader/useReaderSystemInfo";
import { useReaderTTS } from "./reader/useReaderTTS";
import { useVolumeButtonPaging } from "./reader/useVolumeButtonPaging";

const READER_HTML_ASSET = Asset.fromModule(require("../../assets/reader/reader.html"));
const LOCAL_FONT_SERVER_DIR = "readany-fonts";

type Props = NativeStackScreenProps<RootStackParamList, "Reader">;
type TTSSegment = VisibleTTSSegment;

// ──────────────────────────── helpers ────────────────────────────

function buildCustomFontFaceCSS(
  fonts: import("@readany/core/types/font").CustomFont[],
  selectedFontId: string | null,
  localServerUrl?: string | null,
): string {
  if (!selectedFontId) return "";
  const platform = getPlatformService();
  return fonts
    .filter((f) => f.id === selectedFontId)
    .map((f) => {
      // CSS-based remote fonts: @import into the reader iframe
      if (f.source === "remote" && f.remoteCssUrl) {
        return `@import url('${f.remoteCssUrl}');`;
      }
      if (f.source === "remote") return getCSSFontFace(f);
      if (!f.filePath) return "";
      const fileUrl = localServerUrl
        ? `${localServerUrl.replace(/\/$/, "")}/${LOCAL_FONT_SERVER_DIR}/${encodeURIComponent(f.fileName)}`
        : platform.convertFileSrc(f.filePath);
      const cssFormat =
        f.format === "otf"
          ? "opentype"
          : f.format === "woff"
            ? "woff"
            : f.format === "woff2"
              ? "woff2"
              : "truetype";
      return `@font-face {\n  font-family: ${JSON.stringify(f.fontFamily)};\n  src: url('${fileUrl}') format('${cssFormat}');\n  font-weight: normal;\n  font-style: normal;\n}`;
    })
    .filter(Boolean)
    .join("\n");
}

function resolveReaderFontFamily(
  fonts: import("@readany/core/types/font").CustomFont[],
  selectedFontId: string | null,
): string {
  return (
    getBundledReaderFontFamily(selectedFontId) ??
    fonts.find((font) => font.id === selectedFontId)?.fontFamily ??
    DEFAULT_READER_FONT_FAMILY
  );
}

// ──────────────────────────── ReaderScreen ────────────────────────────
export function ReaderScreen(props: Props) {
  const { t } = useTranslation();
  const importBooks = useLibraryStore((state) => state.importBooks);
  const updateBook = useLibraryStore((state) => state.updateBook);
  const requestedBookId = props.route.params.bookId;
  const catalogBookId = props.route.params.catalogBookId;
  const [resolvedBookId, setResolvedBookId] = useState<string | null>(
    catalogBookId ? null : requestedBookId,
  );

  useEffect(() => {
    if (!catalogBookId) {
      setResolvedBookId(requestedBookId);
      return;
    }

    const catalogBook = BUNDLED_CATALOG_BOOKS.find((book) => book.id === catalogBookId);
    if (!catalogBook) {
      Alert.alert(
        t("library.catalogImportErrorTitle", "Не получилось добавить книгу"),
        t("library.catalogImportErrorDescription", "Попробуйте ещё раз."),
        [{ text: t("common.ok", "OK"), onPress: () => props.navigation.goBack() }],
      );
      return;
    }

    let cancelled = false;
    const prepareCatalogBook = async () => {
      const existingBook = useLibraryStore
        .getState()
        .books.find(
          (book) =>
            !book.deletedAt &&
            normalizeCatalogIdentity(book.meta.title) ===
              normalizeCatalogIdentity(catalogBook.title),
        );
      if (existingBook) return existingBook.id;

      const uri = await resolveBundledCatalogBookUri(catalogBook);
      const result = await importBooks([{ uri, name: catalogBook.fileName }]);
      const importedBook = result.imported[0] ?? result.skippedDuplicates[0]?.existingBook;
      if (!importedBook) throw new Error("catalog-import-failed");

      const normalizedMeta = {
        ...importedBook.meta,
        title: catalogBook.title,
        author: catalogBook.author,
      };
      await updateBook(importedBook.id, { meta: normalizedMeta });
      void installBundledCatalogCover(importedBook.id, catalogBook)
        .then((coverUrl) => updateBook(importedBook.id, { meta: { ...normalizedMeta, coverUrl } }))
        .catch((error) =>
          console.warn(`[Catalog] Failed to install cover ${catalogBook.id}:`, error),
        );
      return importedBook.id;
    };

    void prepareCatalogBook()
      .then((bookId) => {
        if (!cancelled) setResolvedBookId(bookId);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(`[Catalog] Failed to add ${catalogBook.id}:`, error);
        Alert.alert(
          t("library.catalogImportErrorTitle", "Не получилось добавить книгу"),
          t("library.catalogImportErrorDescription", "Попробуйте ещё раз."),
          [{ text: t("common.ok", "OK"), onPress: () => props.navigation.goBack() }],
        );
      });

    return () => {
      cancelled = true;
    };
  }, [catalogBookId, importBooks, props.navigation, requestedBookId, t, updateBook]);

  if (!resolvedBookId) {
    return <ReaderLoadingChrome navigation={props.navigation} />;
  }

  return (
    <ReaderContent
      {...props}
      route={{
        ...props.route,
        params: { ...props.route.params, bookId: resolvedBookId, catalogBookId: undefined },
      }}
    />
  );
}

function ReaderLoadingChrome({ navigation }: { navigation: Props["navigation"] }) {
  const colors = useColors();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const ignorePress = () => undefined;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTransparent: true,
      headerShadowVisible: false,
      headerBackButtonDisplayMode: "minimal",
      headerTintColor: colors.foreground,
      headerTitleAlign: "center",
      title: "",
      unstable_headerRightItems: undefined,
      headerRight: () => (
        <View pointerEvents="none">
          <NativeContextMenuButton
            accessibilityLabel="Действия с книгой"
            items={[]}
            color={colors.foreground}
          />
        </View>
      ),
    });
  }, [colors.foreground, navigation]);

  return (
    <View style={{ flex: 1, paddingBottom: insets.bottom, backgroundColor: colors.background }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
      {Platform.OS === "ios" && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            left: 0,
            height: TOOLBAR_HEIGHT + insets.bottom,
            paddingBottom: insets.bottom,
            backgroundColor: colors.background,
          }}
        >
          <ReaderToolbar
            tintColor={colors.foreground}
            isDark={isDark}
            speechActive={false}
            onSpeechPress={ignorePress}
            onChatPress={ignorePress}
            onSettingsPress={ignorePress}
          />
        </View>
      )}
    </View>
  );
}

function ReaderContent({ route, navigation }: Props) {
  const colors = useColors();
  const { mode: themeMode, isDark } = useTheme();
  const s = makeStyles(colors);
  const { bookId, cfi, highlight: shouldHighlight, openTTS } = route.params;
  const { t } = useTranslation();
  const bookmarkCopy = useMemo(() => getReaderBookmarkCopy(t), [t]);
  const isIPadLayout = Platform.OS === "ios" && Platform.isPad;
  const baseTopInset = Platform.OS === "ios" ? 20 : 24;

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [tocActiveTab, setTocActiveTab] = useState<ReaderNavTab>("toc");
  const [showSettings, setShowSettings] = useState(false);
  const [showNotebook, setShowNotebook] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationText, setTranslationText] = useState("");
  const [showTTS, setShowTTS] = useState(false);
  const [showChapterTranslation, setShowChapterTranslation] = useState(false);
  const [isReimporting, setIsReimporting] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [progress, setProgress] = useState(0);
  const [currentChapter, setCurrentChapter] = useState("");
  const [currentChapterHref, setCurrentChapterHref] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  // Позиция по всей книге (foliate location, как «стр. N из M» в Apple Books)
  const [bookLocation, setBookLocation] = useState<{ current: number; total: number } | null>(null);
  const [toc, setToc] = useState<TOCItem[]>([]);
  const [bookTitle, setBookTitle] = useState("");
  const [webViewReady, setWebViewReady] = useState(false);
  const [translationReady, setTranslationReady] = useState(false);
  const [readerHtmlUri, setReaderHtmlUri] = useState<string | null>(null);
  const [currentCfi, setCurrentCfi] = useState("");
  const [selection, setSelection] = useState<SelectionEvent | null>(null);
  const selectionRef = useRef<SelectionEvent | null>(null);
  const [fontServerUrl, setFontServerUrl] = useState<string | null>(null);
  const [defaultReaderFontFaceCSS, setDefaultReaderFontFaceCSS] = useState("");
  const [noteViewHighlight, setNoteViewHighlight] = useState<{
    id: string;
    text: string;
    note?: string;
    cfi: string;
    color: string;
  } | null>(null);
  const [noteViewEditing, setNoteViewEditing] = useState(false);
  const [noteViewContent, setNoteViewContent] = useState("");
  const [noteTooltip, setNoteTooltip] = useState<{
    note: string;
    cfi: string;
    position: { x: number; y: number; selectionTop: number; selectionBottom: number };
  } | null>(null);
  const noteTooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTooltipVisibleRef = useRef(false);
  const suppressReaderTapUntilRef = useRef(0);
  const assetLoadedRef = useRef(false);
  // Mediator ref so onRelocate can fire TTS continuation without direct hook dependency
  const ttsPendingContinueRef = useRef<{
    pendingTTSContinueCallbackRef: React.RefObject<(() => void) | null>;
    pendingTTSContinueSafetyTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  } | null>(null);

  const bridgeRef = useRef<{
    requestPageSnippet: () => void;
    goNext: () => void;
    search: (query: string) => void;
    clearSearch: () => void;
    navigateSearch: (index: number) => void;
    getVisibleText: () => Promise<string>;
    getVisibleTTSSegments: (alignCfi?: string | null) => Promise<TTSSegment[]>;
    getChapterParagraphs: () => Promise<Array<{ id: string; text: string; tagName: string }>>;
    getTTSSegmentContext: (
      cfi: string,
      before?: number,
      after?: number,
    ) => Promise<{ before: TTSSegment[]; after: TTSSegment[] }>;
    getHrefTTSSegments?: (href: string, count?: number) => Promise<TTSSegment[]>;
    getChapterTTSSegments?: (
      startHref: string,
      endHref?: string,
      count?: number,
    ) => Promise<TTSSegment[]>;
    getSectionTTSSegments?: (sectionIndex: number, count?: number) => Promise<TTSSegment[]>;
    goToFraction: (fraction: number) => void;
    goToSection: (sectionIndex: number) => void;
    goToCFI: (cfi: string) => void;
    goToHref: (href: string) => void;
    flashHighlight: (cfi: string, color?: string, duration?: number) => void;
    addAnnotation: (annotation: {
      value: string;
      type?: string;
      color?: string;
      note?: string;
    }) => void;
    removeAnnotation: (annotation: { value: string; type?: string }) => void;
    setTTSHighlight: (cfi: string | null, color?: string, force?: boolean) => void;
    insertSceneSlot: () => void;
    replaceSceneSlot: (anchor: string, imageDataUri: string) => void;
    setSceneSlotState: (anchor: string, state: "idle" | "loading" | "error") => void;
  } | null>(null);

  // Chapter translation state
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const chapterTranslationBridgeRef = useRef<{
    getChapterParagraphs: () => Promise<Array<{ id: string; text: string; tagName: string }>>;
    injectChapterTranslations: (
      results: Array<{ paragraphId: string; originalText: string; translatedText: string }>,
      visibility?: { originalVisible: boolean; translationVisible: boolean },
    ) => Promise<void>;
    removeChapterTranslations: () => void;
  } | null>(null);

  const readSettings = useSettingsStore((s) => s.readSettings);
  const updateReadSettings = useSettingsStore((s) => s.updateReadSettings);
  const translationConfig = useSettingsStore((s) => s.translationConfig);
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const showTopTitleProgress = readSettings.showTopTitleProgress !== false;

  // Тема страницы (пресет Aa-панели): «Оригинал» — цвета приложения,
  // «Сепия»/«Тёмная» — собственные палитры только внутри WebView
  const readerThemeColors = useMemo(
    () =>
      resolveReaderThemeColors(readSettings.readerTheme, {
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.mutedForeground,
        primary: colors.primary,
      }),
    [readSettings.readerTheme, colors],
  );
  const readerThemeColorsRef = useRef(readerThemeColors);
  readerThemeColorsRef.current = readerThemeColors;

  // Track OS-level accessibility font scale; re-renders when the user
  // changes the system font size while the reader is open.
  const { fontScale: systemFontScale } = useWindowDimensions();
  // Apply the system scale only when the user has opted into
  // followSystemFontScale. The store keeps the user's raw fontSize, so
  // toggling the option (or changing OS font size) doesn't drift the
  // stepper value.
  const computeEffectiveFontSize = useCallback(
    (rawFontSize: number, follow: boolean | undefined): number =>
      follow ? Math.max(1, Math.round(rawFontSize * systemFontScale)) : rawFontSize,
    [systemFontScale],
  );

  // Custom fonts — build @font-face CSS per-font using individual filePath
  const customFonts = useFontStore((s) => s.fonts);
  const selectedFontId = useFontStore((s) => s.selectedFontId);
  const readerFontFamily = useMemo(
    () => resolveReaderFontFamily(customFonts, selectedFontId),
    [customFonts, selectedFontId],
  );
  const readerFontFaceCSS = useMemo(
    () =>
      [defaultReaderFontFaceCSS, buildCustomFontFaceCSS(customFonts, selectedFontId, fontServerUrl)]
        .filter(Boolean)
        .join("\n"),
    [customFonts, defaultReaderFontFaceCSS, selectedFontId, fontServerUrl],
  );

  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readerPullAnim = useRef(new Animated.Value(0)).current;
  const lastCfiRef = useRef<string>("");
  const progressRef = useRef(0);
  const locationHistoryRef = useRef<string[]>([]);
  const lastNavigatedCfiRef = useRef<string | undefined>(undefined);
  const fileServerRef = useRef<string | null>(null);
  const defaultReaderFontFaceCSSRef = useRef("");
  const sessionProgressRef = useRef<{
    mode: "location" | "page" | "characters";
    current: number;
    fraction?: number;
    section?: number;
    page?: number;
  } | null>(null);
  const totalBookCharactersRef = useRef<number | null>(null);
  const progressTrackingGuardUntilRef = useRef(0);

  const incrementPagesRead = useReadingSessionStore((s) => s.incrementPagesRead);
  const incrementCharactersRead = useReadingSessionStore((s) => s.incrementCharactersRead);
  const readingActiveTime = useReadingSessionStore(
    (state) => state.currentSession?.totalActiveTime ?? 0,
  );
  const qualifiedReadingRecordedRef = useRef(false);
  const { sendEvent } = useReadingSession(bookId); // Added useReadingSession hook
  const { books, updateBook } = useLibraryStore();
  const setGoToCfiFn = useReaderStore((s) => s.setGoToCfiFn);

  // Throttled progress save (same as desktop - 5 seconds)
  const throttledSaveProgress = useRef(
    throttle((bId: string, prog: number, cfi: string) => {
      updateBook(bId, {
        progress: prog,
        currentCfi: cfi,
      });
    }, 5000),
  ).current;
  const { loadAnnotations, highlights, removeBookmark } = useAnnotationStore();
  const book = useMemo(() => books.find((b) => b.id === bookId), [books, bookId]);

  // ── Narra: кликабельные имена персонажей ────────────────────────────────────
  const narraBookCharacters = useNarraStore((state) => state.books[bookId]?.characters);
  const setNarraCharacters = useNarraStore((state) => state.setCharacters);
  const bundledCharacters = useMemo(
    () => (book ? getBundledCatalogCharactersByTitle(book.meta.title) : undefined),
    [book],
  );
  const characters = useMemo<NarraCharacter[]>(
    () => (narraBookCharacters?.length ? narraBookCharacters : (bundledCharacters ?? [])),
    [narraBookCharacters, bundledCharacters],
  );
  const charactersFromBundledCatalog = !narraBookCharacters?.length;
  // Ключ состава открытых персонажей: спека пересобирается только при unlock,
  // а не на каждом изменении прогресса
  const unlockedCharacterIdsKey = useMemo(
    () =>
      characters
        .filter((character) => isCharacterUnlocked(progress, character))
        .map((character) => character.id)
        .join(","),
    [characters, progress],
  );
  const characterNameSpecJson = useMemo(() => {
    const unlockedIds = new Set(unlockedCharacterIdsKey.split(",").filter(Boolean));
    if (unlockedIds.size === 0) return null;
    const unlocked = characters.filter((character) => unlockedIds.has(character.id));
    return JSON.stringify(buildCharacterNameMatcherSpec(unlocked));
  }, [characters, unlockedCharacterIdsKey]);
  const [characterCard, setCharacterCard] = useState<NarraCharacter | null>(null);

  // ── Narra: врезки сцен внутри текста раз в N страниц (P6 → P14) ─────────────
  // Счётчик перелистываний прежний (scene-suggestion.ts); по сигналу в конец
  // видимого фрагмента WebView вставляет слот «Показать сцену», тап по нему
  // запускает генерацию, готовая картинка встаёт в текст на место слота.
  const sceneSuggestionInterval = useNarraStore((state) => state.sceneSuggestionInterval);
  const sceneSuggestionStateRef = useRef(INITIAL_SCENE_SUGGESTION_STATE);
  const narraScenes = useNarraStore((state) => state.books[bookId]?.scenes);
  const setNarraScene = useNarraStore((state) => state.setScene);
  const sceneSlotBusyRef = useRef(new Set<string>());

  // Видимый текст страницы — контекст для промпта сцены (как в P6)
  const collectVisibleSceneExcerpt = useCallback(async () => {
    const bridge = bridgeRef.current;
    let excerpt = (await bridge?.getVisibleText())?.trim() ?? "";
    if (!excerpt) {
      const visibleSegments = await bridge?.getVisibleTTSSegments(currentCfi || null);
      excerpt = (visibleSegments ?? [])
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join(" ");
    }
    return excerpt.trim();
  }, [currentCfi]);

  // Генерация (или перегенерация) сцены для врезки: слот уже показывает
  // плейсхолдер «Рисуем сцену…» — сюда приходим по событию из WebView.
  const runSceneSlotGeneration = useCallback(
    async (anchor: string) => {
      if (sceneSlotBusyRef.current.has(anchor)) return;
      sceneSlotBusyRef.current.add(anchor);
      try {
        const sourceKey = sceneSourceKeyForAnchor(anchor);
        const cached = useNarraStore.getState().books[bookId]?.scenes?.[sourceKey];
        // Перегенерация — тот же контекст, что у сохранённой сцены
        const excerpt = cached?.excerpt?.trim() || (await collectVisibleSceneExcerpt());
        if (!excerpt) {
          bridgeRef.current?.setSceneSlotState(anchor, "error");
          return;
        }
        const chapter =
          cached?.chapter || currentChapter || bookTitle || book?.meta.title || "Текущая страница";
        const imageUri = await generateNarraSceneImage(bookId, chapter, excerpt, characters);
        setNarraScene(bookId, {
          sourceKey,
          chapter,
          excerpt,
          imageUri,
          generatedAt: Date.now(),
          anchor,
        });
        // Файл читается в RN и передаётся data-URI — WebView не ходит в ФС
        const base64 = await FileSystem.readAsStringAsync(
          normalizePersistedNarraMediaUri(imageUri),
          { encoding: FileSystem.EncodingType.Base64 },
        );
        bridgeRef.current?.replaceSceneSlot(anchor, sceneImageDataUri(base64, imageUri));
      } catch (cause) {
        console.log("[SceneSlot] generation failed", { anchor, cause: String(cause) });
        reportNarraError("scene_image", cause);
        bridgeRef.current?.setSceneSlotState(anchor, "error");
      } finally {
        sceneSlotBusyRef.current.delete(anchor);
      }
    },
    [
      book?.meta.title,
      bookId,
      bookTitle,
      characters,
      collectVisibleSceneExcerpt,
      currentChapter,
      setNarraScene,
    ],
  );

  // Врезка восстановлена при загрузке секции — вернуть сохранённую картинку
  const handleSceneSlotRestored = useCallback(
    async (anchor: string) => {
      try {
        const sourceKey = sceneSourceKeyForAnchor(anchor);
        const cached = useNarraStore.getState().books[bookId]?.scenes?.[sourceKey];
        if (!cached?.imageUri) {
          bridgeRef.current?.setSceneSlotState(anchor, "idle");
          return;
        }
        const uri = normalizePersistedNarraMediaUri(cached.imageUri);
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        bridgeRef.current?.replaceSceneSlot(anchor, sceneImageDataUri(base64, uri));
      } catch (cause) {
        // Файл картинки потерян — слот возвращается в состояние «Показать сцену»
        console.warn("[Reader] Failed to restore scene insert", cause);
        bridgeRef.current?.setSceneSlotState(anchor, "idle");
      }
    },
    [bookId],
  );

  const handleOpenCharacterChat = useCallback(
    (character: NarraCharacter) => {
      // Чат ищет персонажа в narra-store — bundled-каталог сначала фиксируем там
      if (charactersFromBundledCatalog && bundledCharacters?.length) {
        setNarraCharacters(bookId, bundledCharacters);
      }
      setCharacterCard(null);
      navigation.navigate("NarraCharacterChat", { bookId, characterId: character.id });
    },
    [bookId, bundledCharacters, charactersFromBundledCatalog, navigation, setNarraCharacters],
  );

  useEffect(() => {
    if (qualifiedReadingRecordedRef.current || readingActiveTime < 60_000) return;
    qualifiedReadingRecordedRef.current = true;
    recordTelemetry("reading_session_qualified", {
      book_kind: book && findBundledCatalogBookByTitle(book.meta.title) ? "builtin" : "imported",
      duration_seconds: Math.round(readingActiveTime / 1_000),
      duration_bucket: durationBucket(readingActiveTime),
    });
  }, [book, readingActiveTime]);

  // ── System safe area ────────────────────────────────────────────────────────
  const { stableTopInset, insets } = useReaderSystemInfo({
    isIPadLayout,
    baseTopInset,
  });

  // ── Bookmark ───────────────────────────────────────────────────────────────
  const bookmark = useReaderBookmark({
    bookId,
    currentCfi,
    currentChapter,
    requestPageSnippet: () => bridgeRef.current?.requestPageSnippet(),
  });
  const { isBookmarked, bookBookmarks, handleToggleBookmark } = bookmark;

  useLayoutEffect(() => {
    navigation.setOptions({
      // Меню действий живёт внутри шапки: пока оно открыто, шапку скрывать
      // нельзя, иначе меню размонтируется вместе с ней.
      headerShown: showControls || actionsMenuOpen,
      headerTransparent: true,
      headerShadowVisible: false,
      headerBackButtonDisplayMode: "minimal",
      headerTintColor: colors.foreground,
      headerTitleAlign: "center",
      title: "",
    });
  }, [actionsMenuOpen, colors.foreground, navigation, showControls]);

  const suppressProgressTracking = useCallback((duration = PROGRAMMATIC_NAV_GUARD_MS) => {
    progressTrackingGuardUntilRef.current = Math.max(
      progressTrackingGuardUntilRef.current,
      Date.now() + duration,
    );
  }, []);

  const goToCFISafely = useCallback(
    (targetCfi: string) => {
      if (!targetCfi) return;
      suppressProgressTracking();
      bridgeRef.current?.goToCFI(targetCfi);
    },
    [suppressProgressTracking],
  );

  const goToHrefSafely = useCallback(
    (href: string) => {
      if (!href) return;
      suppressProgressTracking();
      bridgeRef.current?.goToHref(href);
    },
    [suppressProgressTracking],
  );

  // ── Search (вкладка «Поиск» единой панели) ─────────────────────────────────
  // Use bridgeRef for lazy access (bridge is initialized later)
  const search = useReaderSearch({
    bridge: {
      search: (q) => bridgeRef.current?.search?.(q),
      clearSearch: () => bridgeRef.current?.clearSearch?.(),
      goToCFI: (cfi) => goToCFISafely(cfi),
    },
  });

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    sessionProgressRef.current = null;
    totalBookCharactersRef.current = null;
    sceneSuggestionStateRef.current = INITIAL_SCENE_SUGGESTION_STATE;
    suppressProgressTracking(INITIAL_PROGRESS_RESTORE_GUARD_MS);
  }, [bookId]);
  const chapterTranslation = useChapterTranslation({
    bookId,
    sectionIndex: currentSectionIndex,
    aiConfig,
    ready: translationReady,
    translationConfig,
    getParagraphs: async () => {
      if (!chapterTranslationBridgeRef.current) return [];
      return chapterTranslationBridgeRef.current.getChapterParagraphs();
    },
    injectTranslations: (results, visibility) => {
      return chapterTranslationBridgeRef.current?.injectChapterTranslations(results, visibility);
    },
    removeTranslations: () => {
      chapterTranslationBridgeRef.current?.removeChapterTranslations();
    },
    applyVisibility: (originalVisible, translationVisible) => {
      const translationHidden = !translationVisible;
      const originalHidden = !originalVisible;
      const solo = !originalVisible && translationVisible;
      bridge.webViewRef.current?.injectJavaScript(`
        (function() {
          try {
            var doc = null;
            var renderer = typeof view !== 'undefined' && view && view.renderer;
            if (renderer && renderer.getContents) {
              var contents = renderer.getContents();
              if (contents && contents[0] && contents[0].doc) doc = contents[0].doc;
            }
            if (!doc) {
              var iframes = document.querySelectorAll('iframe');
              for (var fi = 0; fi < iframes.length; fi++) {
                try {
                  var iframeDoc = iframes[fi].contentDocument || (iframes[fi].contentWindow && iframes[fi].contentWindow.document);
                  if (iframeDoc && iframeDoc.body) { doc = iframeDoc; break; }
                } catch (e) {}
              }
            }
            if (!doc) return;
            var els = doc.querySelectorAll('.readany-translation');
            for (var i = 0; i < els.length; i++) {
              els[i].setAttribute('data-hidden', '${translationHidden}');
              els[i].setAttribute('data-solo', '${solo}');
            }
            var origEls = doc.querySelectorAll('[data-translate-id]');
            for (var j = 0; j < origEls.length; j++) {
              origEls[j].setAttribute('data-original-hidden', '${originalHidden}');
            }
          } catch(e) {}
        })();
        true;
      `);
    },
    getCurrentCfi: () => currentCfi,
    goToCfi: (cfi) => bridgeRef.current?.goToCFI(cfi),
  });

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  // Also read ttsPlayState from store for volume paging guard
  const ttsPlayState = useTTSStore((s) => s.playState);
  const ttsConfig = useTTSStore((s) => s.config);

  // Focus & foreground state for volume paging whitelist
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(true);

  useEffect(() => {
    if (!isFocused) return;

    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      setShowControls(false);
      controlsTimer.current = null;
    }, CONTROLS_TIMEOUT);

    return () => {
      if (controlsTimer.current) {
        clearTimeout(controlsTimer.current);
        controlsTimer.current = null;
      }
    };
  }, [isFocused]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) =>
      setAppActive(s === "active"),
    );
    return () => sub.remove();
  }, []);

  // Load reader HTML asset
  useEffect(() => {
    if (assetLoadedRef.current) return;
    assetLoadedRef.current = true;

    const loadAsset = async () => {
      try {
        const asset = READER_HTML_ASSET;
        await asset.downloadAsync();
        const uri = asset.localUri || asset.uri;
        setReaderHtmlUri(uri);
      } catch (err) {
        console.error("[ReaderScreen] Failed to load reader.html asset:", err);
        setError("Failed to load reader");
      }
    };
    loadAsset();
  }, []);

  // Controls toggle — declared before bridge so onTap can reference it without TS error
  const toggleControls = useCallback(() => {
    const willShow = !showControls;
    setShowControls(willShow);

    if (controlsTimer.current) {
      clearTimeout(controlsTimer.current);
      controlsTimer.current = null;
    }

    if (willShow) {
      controlsTimer.current = setTimeout(() => {
        setShowControls(false);
        controlsTimer.current = null;
      }, CONTROLS_TIMEOUT);
    }
  }, [showControls]);

  const handleReaderBackSwipe = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.popTo("Tabs");
      return;
    }
    navigation.navigate("Tabs");
  }, [navigation]);

  const readerBackSwipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(Platform.OS === "ios")
        .activeOffsetX(18)
        .failOffsetY([-24, 24])
        .onEnd((event) => {
          if (event.translationX >= 72 || event.velocityX >= 520) {
            runOnJS(handleReaderBackSwipe)();
          }
        }),
    [handleReaderBackSwipe],
  );

  // Reader bridge
  const bridge = useReaderBridge({
    onReady: () => {
      setWebViewReady(true);
      bridge.webViewRef.current?.injectJavaScript(`
        (function() {
          if (!window.__view && document.querySelector('foliate-view')) {
            window.__view = document.querySelector('foliate-view');
          }
        })();
        true;
      `);
    },
    onLoaded: () => {
      setLoading(false);
      const settings = useSettingsStore.getState().readSettings;
      const { fonts, selectedFontId: selId } = useFontStore.getState();
      const fontCSS = [
        defaultReaderFontFaceCSSRef.current,
        buildCustomFontFaceCSS(fonts, selId, fileServerRef.current),
      ]
        .filter(Boolean)
        .join("\n");
      const fontFamily = resolveReaderFontFamily(fonts, selId);
      console.log("[ReaderScreen][Font] selection", {
        selectedFontId: selId,
        fontFamily,
        fontCSSLength: fontCSS.length,
      });
      bridge.applySettings({
        fontSize: computeEffectiveFontSize(settings.fontSize, settings.followSystemFontScale),
        lineHeight: settings.lineHeight,
        paragraphSpacing: settings.paragraphSpacing,
        pageMargin: settings.pageMargin,
        fontTheme: settings.fontTheme,
        viewMode: settings.viewMode,
        paginatedLayout: settings.paginatedLayout,
        customFontFaceCSS: fontCSS,
        customFontFamily: fontFamily ?? "",
      });

      // Auto-restore ruby annotations if enabled for this book
      const rubyMode = useRubyStore.getState().getBookRuby(bookId);
      if (rubyMode) {
        void (async () => {
          try {
            const { checkExistingDictMobile, readDictStrings } = await import(
              "@/lib/ruby/dict-service-mobile"
            );
            const exists = await checkExistingDictMobile();
            if (exists) {
              const { wordDict, charDict } = await readDictStrings();
              if (wordDict || charDict) {
                bridge.setRubyDicts(wordDict, charDict);
                setTimeout(() => bridge.injectRuby(rubyMode), 150);
              }
            }
          } catch (err) {
            console.error("[ReaderScreen] Ruby auto-restore failed:", err);
          }
        })();
      }
    },
    onBookTextMetrics: ({ totalCharacters }) => {
      totalBookCharactersRef.current = totalCharacters > 0 ? totalCharacters : null;
    },
    onRelocate: (detail: RelocateEvent) => {
      console.log("[ReaderScreen] onRelocate", {
        section: detail.section,
        fraction: detail.fraction,
        cfi: detail.cfi,
        routeCfi: cfi,
        lastNavigated: lastNavigatedCfiRef.current,
      });
      if (loading) {
        setLoading(false);
      }
      // Track section changes for chapter translation reset
      const newSection = detail.section?.current ?? 0;
      if (newSection !== currentSectionIndex) {
        setCurrentSectionIndex(newSection);
        setTranslationReady(false);
        chapterTranslation.reset();
      }

      if (detail.fraction != null) setProgress(detail.fraction);

      if (detail.page) {
        setCurrentPage(Math.max(1, detail.page.current));
        setTotalPages(Math.max(1, detail.page.total));
      } else if (detail.section?.total && !detail.location?.total) {
        // Fixed-layout documents can still expose stable section pages.
        setCurrentPage(Math.max(1, detail.section.current + 1));
        setTotalPages(Math.max(1, detail.section.total));
      } else {
        // Reflowable books without renderer-backed pagination should fall back to percent.
        setCurrentPage(0);
        setTotalPages(0);
      }

      // «стр. N из M» по всей книге — из foliate location (нет в scrolled/fixed)
      setBookLocation(
        detail.location?.total
          ? { current: detail.location.current, total: detail.location.total }
          : null,
      );

      const trackingSuppressed = Date.now() < progressTrackingGuardUntilRef.current;

      if (detail.location?.total) {
        const totalBookCharacters = totalBookCharactersRef.current;
        const fraction = detail.fraction ?? 0;
        if (totalBookCharacters && totalBookCharacters > 0) {
          const currentCharacters = Math.round(totalBookCharacters * fraction);
          const previous = sessionProgressRef.current;
          const currentSection = detail.section?.current ?? 0;
          const currentRendererPage = detail.page?.current ?? null;

          if (
            !trackingSuppressed &&
            previous?.mode === "characters" &&
            currentCharacters > previous.current
          ) {
            if (currentRendererPage != null && previous.page != null && previous.section != null) {
              const samePage =
                previous.section === currentSection && previous.page === currentRendererPage;
              const movedForwardWithinSection =
                previous.section === currentSection &&
                currentRendererPage > previous.page &&
                currentRendererPage - previous.page <= MAX_TRACKED_PAGE_DELTA;
              const movedForwardAcrossSection =
                currentSection > previous.section && currentSection - previous.section <= 1;

              if (!samePage && (movedForwardWithinSection || movedForwardAcrossSection)) {
                incrementCharactersRead(currentCharacters - previous.current);
              }
            } else if (
              Math.abs(fraction - (previous.fraction ?? 0)) <= MAX_TRACKED_FRACTION_DELTA
            ) {
              incrementCharactersRead(currentCharacters - previous.current);
            }
          }
          sessionProgressRef.current = {
            mode: "characters",
            current: currentCharacters,
            fraction,
            section: currentSection,
            page: currentRendererPage ?? undefined,
          };
        } else {
          const previous = sessionProgressRef.current;
          if (
            !trackingSuppressed &&
            previous?.mode === "location" &&
            detail.location.current > previous.current
          ) {
            const delta = detail.location.current - previous.current;
            if (delta <= MAX_TRACKED_LOCATION_DELTA) {
              incrementCharactersRead(delta * REFLOWABLE_CHARACTERS_PER_LOCATION);
            }
          }
          sessionProgressRef.current = {
            mode: "location",
            current: detail.location.current,
            fraction,
          };
        }
      } else if (detail.section?.total) {
        const previous = sessionProgressRef.current;
        if (
          !trackingSuppressed &&
          previous?.mode === "page" &&
          detail.section.current > previous.current
        ) {
          const delta = detail.section.current - previous.current;
          if (delta <= MAX_TRACKED_PAGE_DELTA) {
            incrementPagesRead(delta);
          }
        }
        sessionProgressRef.current = { mode: "page", current: detail.section.current };
      }
      if (detail.tocItem?.label) setCurrentChapter(detail.tocItem.label);
      if (detail.tocItem?.href) setCurrentChapterHref(detail.tocItem.href);
      if (detail.cfi) {
        if (lastCfiRef.current && detail.cfi !== lastCfiRef.current) {
          const fractionDiff = Math.abs((detail.fraction ?? 0) - progress);
          if (fractionDiff > 0.02 || locationHistoryRef.current.length === 0) {
            locationHistoryRef.current.push(lastCfiRef.current);
            if (locationHistoryRef.current.length > 50) {
              locationHistoryRef.current.shift();
            }
          }
        }
        lastCfiRef.current = detail.cfi;
        setCurrentCfi(detail.cfi);
        // Use throttled save instead of immediate update
        throttledSaveProgress(bookId, detail.fraction ?? 0, detail.cfi);
      }

      // Врезки сцен: перелистывания считает foliate relocate, собственной
      // пагинации нет (логика — scene-suggestion.ts). По сигналу счётчика
      // WebView вставляет слот «Показать сцену» в конец видимого фрагмента.
      const sceneAdvance = advanceSceneSuggestion(
        sceneSuggestionStateRef.current,
        detail,
        sceneSuggestionInterval,
        trackingSuppressed,
      );
      sceneSuggestionStateRef.current = sceneAdvance.state;
      if (sceneAdvance.suggest) {
        console.log("[SceneSlot] suggest → insertSceneSlot", {
          interval: sceneSuggestionInterval,
          step: sceneAdvance.state.step,
        });
        bridgeRef.current?.insertSceneSlot();
      } else if (sceneAdvance.moved) {
        console.log("[SceneSlot] move counted", {
          pagesTurned: sceneAdvance.state.pagesTurned,
          interval: sceneSuggestionInterval,
          suppressed: trackingSuppressed,
        });
      }

      // Mark translation ready after first successful relocate (CFI navigation done)
      if (!translationReady) setTranslationReady(true);

      // If TTS is waiting for a page turn to complete, fire the continuation callback now
      // that the renderer has fully updated its position (renderer.start reflects new page).
      if (ttsPendingContinueRef.current?.pendingTTSContinueCallbackRef.current) {
        console.log("[ReaderScreen][TTS] onRelocate triggered pending TTS continuation");
        const cb = ttsPendingContinueRef.current.pendingTTSContinueCallbackRef.current;
        ttsPendingContinueRef.current.pendingTTSContinueCallbackRef.current = null;
        // Cancel the safety timer since onRelocate fired successfully
        const safetyTimerRef = ttsPendingContinueRef.current.pendingTTSContinueSafetyTimerRef;
        if (safetyTimerRef.current) {
          clearTimeout(safetyTimerRef.current);
          safetyTimerRef.current = null;
        }
        void cb();
      }

      // Sync reading context for AI tools
      readingContextService.updateContext({
        bookId,
        bookTitle: book?.meta?.title || "",
        currentChapter: {
          index: detail.section?.current ?? 0,
          title: detail.tocItem?.label || "",
          href: detail.tocItem?.href || "",
        },
        currentPosition: {
          cfi: detail.cfi || "",
          percentage: (detail.fraction ?? 0) * 100,
        },
      });
    },
    onTocReady: (items: TOCItem[]) => {
      setToc(items);
    },
    onSelection: (detail: SelectionEvent) => {
      selectionRef.current = detail;
      setSelection(detail);
      // Sync selection for AI tools
      if (detail.cfi) {
        readingContextService.updateSelection({
          text: detail.text,
          cfi: detail.cfi,
          chapterIndex: 0,
          chapterTitle: "",
        });
      }
    },
    onSelectionCleared: () => {
      setSelection(null);
      readingContextService.clearSelection();
    },
    onTap: () => {
      if (noteTooltipVisibleRef.current || Date.now() < suppressReaderTapUntilRef.current) {
        return;
      }
      sendEvent({ type: "activity" });
      if (selection) {
        selectionRef.current = null;
        setSelection(null);
        return;
      }
      toggleControls();
    },
    onToggleBookmark: () => {
      handleToggleBookmark();
    },
    onBookmarkPull: ({ offset, active }) => {
      if (active) {
        readerPullAnim.setValue(offset);
        return;
      }

      Animated.timing(readerPullAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    },
    onCharacterTap: ({ characterId }) => {
      const character = characters.find((item) => item.id === characterId);
      // Запертые персонажи не размечаются, но на случай гонки — двойная проверка
      if (!character || !isCharacterUnlocked(progress, character)) return;
      // Карточка пишет в narra-store (портрет, выбор голоса) — bundled-каталог
      // сначала фиксируем там, как это делает переход в чат.
      if (charactersFromBundledCatalog && bundledCharacters?.length) {
        setNarraCharacters(bookId, bundledCharacters);
      }
      suppressReaderTapUntilRef.current = Date.now() + 400;
      setCharacterCard(character);
    },
    // Врезки сцен: генерация только по явному тапу, перегенерация — «↻ Заново»
    onSceneSlotTap: ({ anchor }) => {
      console.log("[SceneSlot] tap → generate", { anchor });
      void runSceneSlotGeneration(anchor);
    },
    onSceneSlotRegenerate: ({ anchor }) => {
      console.log("[SceneSlot] regenerate", { anchor });
      void runSceneSlotGeneration(anchor);
    },
    onSceneSlotRestored: ({ anchor }) => {
      void handleSceneSlotRestored(anchor);
    },
    onSearchComplete: (count, results) => {
      search.onSearchComplete(count, results);
    },
    onError: (message: string) => {
      console.error("[Reader] WebView error:", message);
      if (loading) {
        setError(message);
        setLoading(false);
      }
    },
    onShowAnnotation: (detail: {
      value: string;
      position: { x: number; y: number; selectionTop: number; selectionBottom: number };
    }) => {
      suppressReaderTapUntilRef.current = Date.now() + 650;
      const highlight = highlights.find((h) => h.cfi === detail.value);
      if (!highlight) return;
      setSelection({
        text: highlight.text,
        cfi: highlight.cfi,
        position: detail.position,
      });
    },
    onNoteTooltip: (detail) => {
      suppressReaderTapUntilRef.current = Date.now() + 900;
      // Dismiss any existing tooltip
      if (noteTooltipTimer.current) {
        clearTimeout(noteTooltipTimer.current);
      }
      setNoteTooltip({
        note: detail.note,
        cfi: detail.cfi,
        position: detail.position,
      });
      // Auto-hide after 4 seconds
      noteTooltipTimer.current = setTimeout(() => {
        setNoteTooltip(null);
        noteTooltipTimer.current = null;
      }, 4000);
    },
    onPageSnippet: (_text: string) => {
      // page snippet handled by bookmark hook if pending
    },
    onBookmarkSnippet: (text: string) => {
      bookmark.onBookmarkSnippet(text);
    },
  });

  useEffect(() => {
    noteTooltipVisibleRef.current = !!noteTooltip;
  }, [noteTooltip]);

  // ── Volume button paging ─────────────────────────────────────────────────
  const isPureReadingContext = useMemo(
    () =>
      Platform.OS === "android" &&
      readSettings.volumeButtonsPageTurn === true &&
      webViewReady &&
      !loading &&
      !error &&
      !isReimporting &&
      !showTOC &&
      !showSettings &&
      !showNotebook &&
      !showTTS &&
      !showTranslation &&
      !showChapterTranslation &&
      chapterTranslation.state.status === "idle" &&
      !selection &&
      !noteViewHighlight &&
      !noteTooltip &&
      ttsPlayState === "stopped" &&
      isFocused &&
      appActive,
    // 维护约定：任何新增遮盖正文/输入态/导航跳转，必须在此追加判定。
    [
      readSettings.volumeButtonsPageTurn,
      webViewReady,
      loading,
      error,
      isReimporting,
      showTOC,
      showSettings,
      showNotebook,
      showTTS,
      showTranslation,
      showChapterTranslation,
      chapterTranslation.state.status,
      selection,
      noteViewHighlight,
      noteTooltip,
      ttsPlayState,
      isFocused,
      appActive,
    ],
  );

  useVolumeButtonPaging({
    active: isPureReadingContext,
    onPrev: () => bridge.goPrev(),
    onNext: () => bridge.goNext(),
  });

  bridgeRef.current = bridge;
  chapterTranslationBridgeRef.current = bridge;

  // Спека имён персонажей: отправляем при готовности WebView и при unlock новых героев;
  // разметку по секциям WebView делает сам (лениво, по мере загрузки секций)
  const sendCharacterNames = bridge.setCharacterNames;
  useEffect(() => {
    if (!webViewReady) return;
    sendCharacterNames(characterNameSpecJson);
  }, [webViewReady, characterNameSpecJson, sendCharacterNames]);

  // Подписи врезок сцен — локализованные строки внутрь WebView
  const configureSceneSlots = bridge.configureSceneSlots;
  useEffect(() => {
    if (!webViewReady) return;
    configureSceneSlots(
      JSON.stringify({
        idle: t("narra.sceneSlotShow", "Показать сцену"),
        loading: t("narra.sceneSlotDrawing", "Рисуем сцену…"),
        loadingHint: t("narra.sceneSlotDrawingHint", "20–60 секунд"),
        caption: t("narra.sceneSlotCaption", "Сцена — сгенерировано ИИ"),
        regen: t("narra.sceneSlotRegen", "Заново"),
        error: t("narra.sceneSlotError", "Не получилось — попробовать ещё раз"),
      }),
    );
  }, [webViewReady, configureSceneSlots, t]);

  // Якоря сохранённых сцен: WebView восстанавливает врезки при загрузке
  // секций и просит картинки событием sceneSlotRestored
  const sceneAnchorsJson = useMemo(() => {
    const anchors = sceneInsertAnchors(narraScenes);
    return anchors.length ? JSON.stringify(anchors) : null;
  }, [narraScenes]);
  const setSceneAnchors = bridge.setSceneAnchors;
  useEffect(() => {
    if (!webViewReady) return;
    setSceneAnchors(sceneAnchorsJson);
  }, [webViewReady, sceneAnchorsJson, setSceneAnchors]);

  // ── useReaderTTS ──
  const tts = useReaderTTS({
    bookId,
    bookTitle: bookTitle || book?.meta.title || "",
    currentChapter,
    currentChapterHref,
    currentSectionIndex,
    currentCfi,
    webViewReady,
    showTTS,
    setShowTTS,
    setShowControls,
    bridgeRef,
    toc,
    bookCoverUrl: book?.meta.coverUrl,
    colors,
    goToHref: bridge.goToHref,
    characters,
  });

  const openScene = useCallback(
    (excerpt: string, sourceKey: string) => {
      const normalizedExcerpt = excerpt.trim();
      if (!normalizedExcerpt) {
        Alert.alert("Не удалось создать сцену", "На этой странице нет текста для иллюстрации.");
        return;
      }
      navigation.navigate("NarraScene", {
        bookId,
        chapter: currentChapter || bookTitle || book?.meta.title || "Текущая страница",
        excerpt: normalizedExcerpt,
        sourceKey,
      });
    },
    [book?.meta.title, bookId, bookTitle, currentChapter, navigation],
  );

  const handleSelectionMenuAction = useCallback(
    (event: { nativeEvent: { key: string; selectedText: string } }) => {
      const activeSelection = selectionRef.current ?? selection;
      const selectedText = (activeSelection?.text || event.nativeEvent.selectedText).trim();
      if (!selectedText) return;

      const cfi = activeSelection?.cfi ?? "";
      selectionRef.current = null;
      setSelection(null);

      switch (event.nativeEvent.key) {
        case "add-note":
          navigation.navigate("ManualNote", {
            bookId,
            cfi,
            text: selectedText,
            chapterTitle: currentChapter,
          });
          break;
        case "copy":
          void Clipboard.setStringAsync(selectedText);
          break;
        case "translate":
          setTranslationText(selectedText);
          setShowTranslation(true);
          break;
        case "summarize":
          navigation.navigate("NarraSummary", {
            bookId,
            chapter: currentChapter || bookTitle || book?.meta.title || "Текущий фрагмент",
            excerpt: selectedText,
            sourceKey: `selection:${cfi || `${currentChapter}:${selectedText.slice(0, 120)}`}`,
          });
          break;
        case "generate-scene":
          openScene(
            selectedText,
            `selection:${cfi || `${currentChapter}:${selectedText.slice(0, 120)}`}`,
          );
          break;
        case "speak":
          tts.startSelectionTTS(selectedText, cfi);
          break;
      }
    },
    [
      book?.meta.title,
      bookId,
      bookTitle,
      currentChapter,
      navigation,
      openScene,
      selection,
      tts.startSelectionTTS,
    ],
  );

  const handleOpenCharacters = useCallback(() => {
    navigation.navigate("NarraCharacters", { bookId });
  }, [bookId, navigation]);

  useLayoutEffect(() => {
    // Пока открыто меню действий, шапку прятать нельзя: headerRight с ней
    // размонтируется, а вместе с ним исчезает и само меню — оно живёт внутри.
    const headerVisible = showControls || actionsMenuOpen;
    // Единая панель (оглавление/закладки/поиск) + Aa-настройки — один вход с тулбара
    const openNavPanel = (tab: ReaderNavTab) => {
      setTocActiveTab(tab);
      setShowTOC(true);
    };
    const readerActions = [
      {
        label: "Оглавление",
        sfSymbol: "list.bullet",
        onPress: () => openNavPanel("toc"),
      },
      {
        label: isBookmarked ? "Удалить закладку" : "Добавить закладку",
        sfSymbol: isBookmarked ? "bookmark.slash" : "bookmark",
        onPress: handleToggleBookmark,
      },
      {
        label: "Закладки",
        sfSymbol: "bookmark.fill",
        onPress: () => openNavPanel("bookmarks"),
      },
      {
        label: "Поиск",
        sfSymbol: "magnifyingglass",
        onPress: () => openNavPanel("search"),
      },
      {
        label: t("narra.characters", "Персонажи"),
        sfSymbol: "person.2",
        onPress: handleOpenCharacters,
      },
      {
        label: "Оформление",
        sfSymbol: "textformat.size",
        onPress: () => setShowSettings(true),
      },
      {
        label: "Заметки",
        sfSymbol: "square.and.pencil",
        onPress: () => navigation.navigate("FullScreenNotes", { bookId }),
      },
      {
        label: "Язык",
        sfSymbol: "globe",
        onPress: () => setShowChapterTranslation(true),
      },
    ];

    navigation.setOptions(
      Platform.OS === "ios"
        ? {
            headerRight: undefined,
            unstable_headerRightItems: headerVisible
              ? () => [
                  {
                    type: "menu" as const,
                    label: "Действия с книгой",
                    accessibilityLabel: "Действия с книгой",
                    icon: { type: "sfSymbol" as const, name: "ellipsis" as const },
                    menu: {
                      items: readerActions.map((action) => ({
                        type: "action" as const,
                        label: action.label,
                        icon: { type: "sfSymbol" as const, name: action.sfSymbol as never },
                        onPress: action.onPress,
                      })),
                    },
                  },
                ]
              : () => [],
          }
        : {
            unstable_headerRightItems: undefined,
            headerRight: headerVisible
              ? () => (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                    <NativeButton
                      label=""
                      accessibilityLabel="Чат"
                      icon="chat"
                      size="small"
                      variant="tertiary"
                      onPress={handleOpenCharacters}
                    />
                    {/* Явный вход в настройки оформления (шрифт, тема, прокрутка) */}
                    <NativeButton
                      label="Aa"
                      accessibilityLabel={t("narra.readerAppearance", "Оформление")}
                      size="small"
                      variant="tertiary"
                      onPress={() => setShowSettings(true)}
                    />
                    <NativeContextMenuButton
                      accessibilityLabel="Действия с книгой"
                      onOpenChange={setActionsMenuOpen}
                      items={[
                        ...readerActions,
                        {
                          label: "Озвучить",
                          sfSymbol: "waveform",
                          onPress: () => void tts.handleToggleTTS(),
                        },
                      ].map((action) => ({ key: action.label, ...action }))}
                    />
                  </View>
                )
              : undefined,
          },
    );
  }, [
    actionsMenuOpen,
    bookId,
    handleOpenCharacters,
    handleToggleBookmark,
    isBookmarked,
    navigation,
    showControls,
    t,
    tts.handleToggleTTS,
  ]);

  // Bind mediator ref so onRelocate can fire the TTS continuation callback
  ttsPendingContinueRef.current = {
    pendingTTSContinueCallbackRef: tts.pendingTTSContinueCallbackRef,
    pendingTTSContinueSafetyTimerRef: tts.pendingTTSContinueSafetyTimerRef,
  };

  // ── Non-TTS callbacks ──────────────────────────────────────────────────────

  const goToTocItem = useCallback(
    (href: string) => {
      if (lastCfiRef.current) {
        locationHistoryRef.current.push(lastCfiRef.current);
      }
      goToHrefSafely(href);
      setShowTOC(false);
    },
    [goToHrefSafely],
  );

  const goBackToPreviousLocation = useCallback(() => {
    if (locationHistoryRef.current.length === 0) return;
    const previousCfi = locationHistoryRef.current.pop();
    if (previousCfi) {
      goToCFISafely(previousCfi);
    }
  }, [goToCFISafely]);

  const canGoBack = locationHistoryRef.current.length > 0;

  const updateSetting = useCallback(
    <K extends keyof ReadSettings>(key: K, value: ReadSettings[K]) => {
      const updates = { [key]: value } as Partial<ReadSettings>;
      updateReadSettings(updates);
      const currentSettings = useSettingsStore.getState().readSettings;
      const { fonts, selectedFontId: selId } = useFontStore.getState();
      const fontCSS = [
        defaultReaderFontFaceCSSRef.current,
        buildCustomFontFaceCSS(fonts, selId, fileServerRef.current),
      ]
        .filter(Boolean)
        .join("\n");
      const fontFamily = resolveReaderFontFamily(fonts, selId);
      // Recompute effective fontSize after every settings change — covers
      // both stepper changes and toggling followSystemFontScale on/off.
      const merged = { ...currentSettings, ...updates };
      bridge.applySettings({
        ...merged,
        fontSize: computeEffectiveFontSize(merged.fontSize, merged.followSystemFontScale),
        customFontFaceCSS: fontCSS,
        customFontFamily: fontFamily ?? "",
      });
    },
    [bridge, updateReadSettings, computeEffectiveFontSize],
  );

  useEffect(() => {
    setGoToCfiFn(() => bridge.goToCFI);
    return () => setGoToCfiFn(null);
  }, [bridge.goToCFI, setGoToCfiFn]);

  // ── Book loading effects ───────────────────────────────────────────────────

  // Load book metadata and annotations
  useEffect(() => {
    if (!book) {
      setError(t("reader.bookNotFound", "书籍未找到"));
      setLoading(false);
      return;
    }
    setBookTitle(book.meta.title);
    recordTelemetry("book_opened", {
      book_kind: findBundledCatalogBookByTitle(book.meta.title) ? "builtin" : "imported",
    });
    updateBook(bookId, { lastOpenedAt: Date.now() });
    loadAnnotations(bookId);

    return () => {
      readingContextService.clearContext();
    };
  }, [bookId]);

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      void loadAnnotations(bookId);
    });
  }, [bookId, loadAnnotations]);

  // Save progress immediately on unmount
  useEffect(() => {
    return () => {
      if (fileServerRef.current) {
        stopFileServer();
        fileServerRef.current = null;
      }
      if (lastCfiRef.current) {
        const db = require("@readany/core/db/database");
        runWithDbRetry(
          () =>
            db.updateBook(bookId, {
              progress: progressRef.current,
              currentCfi: lastCfiRef.current,
            }),
          { attempts: 10, initialDelayMs: 150 },
        ).catch((err: Error) => console.error("Failed to save progress on unmount:", err));
      }
      const { useSyncStore } = require("@readany/core/stores/sync-store");
      useSyncStore.getState().syncNow?.();
    };
  }, [bookId]);

  // When WebView is ready and book is available, send the open command
  useEffect(() => {
    if (!webViewReady || !book?.filePath) {
      return;
    }

    const loadBook = async () => {
      try {
        setLoading(true);
        setError(null);
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, book.filePath);
        const lastLocation = book.currentCfi || undefined;
        const fileName = book.filePath.split("/").pop() || "book.epub";
        const mimeType = BOOK_FORMAT_MIME_TYPES[book.format] || "application/octet-stream";

        // Start a local HTTP server so the WebView can fetch the file directly.
        // This avoids loading the entire file into RN memory + base64 encoding (33% overhead)
        // and the massive JSON serialization through injectJavaScript.
        const serverUrl = await startFileServer(appData);
        fileServerRef.current = serverUrl;
        setFontServerUrl(serverUrl);
        try {
          const bundledFontCSS = await getBundledReaderFontFaceCSS(serverUrl);
          defaultReaderFontFaceCSSRef.current = bundledFontCSS;
          setDefaultReaderFontFaceCSS(bundledFontCSS);
        } catch (fontError) {
          console.warn("[ReaderScreen] Failed to prepare SB Serif:", fontError);
          defaultReaderFontFaceCSSRef.current = "";
          setDefaultReaderFontFaceCSS("");
        }
        const encodedPath = book.filePath
          .split("/")
          .map((s) => encodeURIComponent(s))
          .join("/");

        bridge.openBook({
          uri: `${serverUrl}/${encodedPath}`,
          fileName,
          mimeType,
          lastLocation,
          pageMargin: readSettings.pageMargin,
          paginatedLayout: readSettings.paginatedLayout,
          settings: {
            fontSize: readSettings.fontSize,
            lineHeight: readSettings.lineHeight,
            paragraphSpacing: readSettings.paragraphSpacing,
            pageMargin: readSettings.pageMargin,
            fontTheme: readSettings.fontTheme,
            viewMode: readSettings.viewMode,
            paginatedLayout: readSettings.paginatedLayout,
          },
        });

        bridge.setThemeColors(readerThemeColorsRef.current);
      } catch (err: any) {
        console.error("[ReaderScreen] Failed to load book:", err);
        setError(err.message || "Failed to load book file");
        setLoading(false);
      }
    };

    loadBook();
  }, [bookId, book?.filePath, loadAttempt, webViewReady]);

  const handleReimportMissingBook = useCallback(async () => {
    if (isReimporting) return;
    setIsReimporting(true);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: BOOK_MIME_TYPES,
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const selectedUri = result.assets[0].uri;
      if (book) {
        const candidate = await useLibraryStore.getState().inspectDeletedBookCandidate(bookId, {
          uri: selectedUri,
          name: result.assets[0].name,
        });
        if (candidate && shouldConfirmReimportCandidate(book, candidate)) {
          const shouldContinue = await useMissingBookPromptStore.getState().showPrompt({
            title: t("reader.reimportMismatchTitle", "这份文件看起来和原书不太一致"),
            description: t(
              "reader.reimportMismatchDescription",
              "原书《{{originalTitle}}》与当前文件《{{candidateTitle}}》信息差异较大。仍要把它接回原来的笔记和阅读统计吗？",
              {
                originalTitle: book.meta.title,
                candidateTitle: candidate.title || t("reader.unknownBook", "未命名书籍"),
              },
            ),
            confirmLabel: t("reader.reimportContinue", "继续接回"),
            cancelLabel: t("reader.reimportPickAnotherFile", "重新选择"),
          });
          if (!shouldContinue) return;
        }
      }

      const restoredBook = await useLibraryStore
        .getState()
        .reimportDeletedBook(bookId, { uri: selectedUri, name: result.assets[0].name });

      if (!restoredBook) {
        setError(t("reader.reimportFailed", "重新导入失败，请稍后再试。"));
        return;
      }

      setError(null);
      setLoading(true);
    } catch (err) {
      console.error("[ReaderScreen] Failed to re-import missing book:", err);
      setError(
        err instanceof Error
          ? err.message
          : t("reader.reimportFailed", "重新导入失败，请稍后再试。"),
      );
    } finally {
      setIsReimporting(false);
    }
  }, [bookId, isReimporting, t]);

  // Apply theme colors when theme changes
  useEffect(() => {
    if (!webViewReady) return;
    bridge.setBookmarkPullState({
      bookmarked: isBookmarked,
      ...bookmarkCopy,
    });
  }, [bookmarkCopy, bridge, isBookmarked, webViewReady]);

  useEffect(() => {
    if (!webViewReady) return;
    bridge.setThemeColors(readerThemeColors);
  }, [themeMode, readerThemeColors, webViewReady]);

  // Re-apply font settings when custom fonts or selected font changes
  useEffect(() => {
    if (!webViewReady) return;
    bridge.applySettings({
      customFontFaceCSS: readerFontFaceCSS,
      customFontFamily: readerFontFamily,
    });
  }, [readerFontFaceCSS, readerFontFamily, webViewReady]);

  // Re-apply effective fontSize when the OS-level font scale changes while
  // the reader is open (e.g. user changes "Display & Brightness → Text Size"
  // in iOS Settings, then comes back). Only fires when followSystemFontScale
  // is on; otherwise the stored fontSize is used as-is and there's nothing
  // to re-push.
  //
  // We also re-send paragraphSpacing and pageMargin so the webview's
  // layoutScale-based scaling (in reader.template.html) re-runs against the
  // new effective font size — otherwise the renderer would keep margins
  // computed from the previous size.
  useEffect(() => {
    if (!webViewReady) return;
    if (!readSettings.followSystemFontScale) return;
    bridge.applySettings({
      fontSize: computeEffectiveFontSize(readSettings.fontSize, true),
      paragraphSpacing: readSettings.paragraphSpacing,
      pageMargin: readSettings.pageMargin,
    });
  }, [
    systemFontScale,
    readSettings.followSystemFontScale,
    readSettings.fontSize,
    readSettings.paragraphSpacing,
    readSettings.pageMargin,
    webViewReady,
    bridge,
    computeEffectiveFontSize,
  ]);

  // Load annotations into reader when ready
  useEffect(() => {
    if (!webViewReady || loading || highlights.length === 0) return;
    for (const h of highlights) {
      bridge.addAnnotation({ value: h.cfi, type: "highlight", color: h.color, note: h.note });
    }
  }, [webViewReady, loading, highlights]);

  // Reset last navigated CFI when book changes
  useEffect(() => {
    lastNavigatedCfiRef.current = undefined;
  }, [bookId]);

  // Navigate to CFI when book is loaded (from NotesPage or AI citation navigation)
  useEffect(() => {
    if (!webViewReady || loading || !cfi || cfi === lastNavigatedCfiRef.current) return;
    goToCFISafely(cfi);
    lastNavigatedCfiRef.current = cfi;
    navigation.setParams({ bookId, cfi: undefined, highlight: undefined });

    if (shouldHighlight) {
      let flashCount = 0;
      const doFlash = () => {
        if (flashCount >= 3) return;
        bridge.flashHighlight(cfi, "orange", 500);
        flashCount++;
        if (flashCount < 3) setTimeout(doFlash, 600);
      };
      setTimeout(doFlash, 100);
    }
  }, [webViewReady, loading, cfi, shouldHighlight, goToCFISafely, navigation, bookId]);

  // Open TTS lyrics page when navigating from notification
  useEffect(() => {
    if (!openTTS || !webViewReady || loading) return;

    let cancelled = false;
    const openLyricsPage = async () => {
      const targetCfi =
        tts.resolvedTTSSegmentCfi || tts.ttsDisplaySegments[0]?.cfi || currentCfi || null;
      if (targetCfi && targetCfi !== currentCfi) {
        goToCFISafely(targetCfi);
        await new Promise((resolve) => setTimeout(resolve, 320));
      }
      if (cancelled) return;
      setShowControls(false);
      setShowTTS(true);
      navigation.setParams({ bookId, openTTS: undefined });
    };

    void openLyricsPage();
    return () => {
      cancelled = true;
    };
  }, [bookId, currentCfi, goToCFISafely, loading, navigation, openTTS, webViewReady]);

  const readerToolbarDock =
    Platform.OS === "ios" ? (
      <View
        pointerEvents={loading || !showControls ? "none" : "auto"}
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 30,
          height: TOOLBAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: colors.background,
          transform: [{ translateY: showControls ? 0 : TOOLBAR_HEIGHT + insets.bottom }],
        }}
      >
        <ReaderToolbar
          tintColor={colors.foreground}
          isDark={isDark}
          speechActive={ttsPlayState === "playing" || ttsPlayState === "loading"}
          onSpeechPress={() => void tts.handleToggleTTS()}
          onChatPress={handleOpenCharacters}
          onSettingsPress={() => setShowSettings(true)}
        />
      </View>
    ) : null;

  if (loading && !webViewReady && !readerHtmlUri) {
    return (
      <View style={[s.container, { paddingBottom: insets.bottom }]}>
        <View style={s.readerStage}>
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </View>
        {readerToolbarDock}
      </View>
    );
  }

  if (error) {
    return (
      <View style={[s.container, { paddingBottom: insets.bottom }]}>
        <View style={s.readerStage}>
          <View style={s.loadingWrap}>
            <Text style={s.errorText}>{t("reader.loadFailed", "加载失败")}</Text>
            <Text style={[s.loadingText, { textAlign: "center", maxWidth: 320 }]}>{error}</Text>
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
              <TouchableOpacity
                style={s.backButton}
                onPress={() => {
                  if (book?.filePath) {
                    setLoading(true);
                    setError(null);
                    setLoadAttempt((value) => value + 1);
                    return;
                  }
                  navigation.reset({ routes: [{ name: "Tabs" }] });
                }}
              >
                <Text style={s.backButtonText}>
                  {book?.filePath ? t("common.retry", "重试") : t("common.back", "返回")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  s.backButton,
                  {
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => void handleReimportMissingBook()}
                disabled={isReimporting}
              >
                <Text style={[s.backButtonText, { color: colors.foreground }]}>
                  {isReimporting
                    ? t("reader.reimporting", "正在重新导入...")
                    : t("reader.reimport", "重新导入")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        {readerToolbarDock}
      </View>
    );
  }

  if (!readerHtmlUri) {
    return (
      <View style={[s.container, { paddingBottom: insets.bottom }]}>
        <View style={s.readerStage}>
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </View>
        {readerToolbarDock}
      </View>
    );
  }

  const layoutTopInset = stableTopInset;
  const percent = Math.round(progress * 100);
  const isPanelOpen = showTOC || showSettings || showNotebook || showTranslation;
  const readerContentInset = Math.round(
    readSettings.pageMargin *
      (computeEffectiveFontSize(readSettings.fontSize, readSettings.followSystemFontScale) / 16),
  );
  const readerTopMargin = showTopTitleProgress ? layoutTopInset + 30 : layoutTopInset;
  const adjustedNoteTooltip = noteTooltip
    ? {
        ...noteTooltip,
        position: {
          ...noteTooltip.position,
          y: noteTooltip.position.y + readerTopMargin,
          selectionTop: noteTooltip.position.selectionTop + readerTopMargin,
          selectionBottom: noteTooltip.position.selectionBottom + readerTopMargin,
        },
      }
    : null;

  return (
    <>
      <View style={[s.container, { paddingBottom: insets.bottom }]}>
        <Animated.View
          style={[s.readerStage, { transform: [{ translateY: readerPullAnim }] }]}
          pointerEvents="box-none"
        >
          {/* WebView with foliate-js */}
          <View style={{ flex: 1 }}>
            <WebView
              ref={bridge.webViewRef}
              source={{ uri: readerHtmlUri }}
              style={[
                s.webview,
                {
                  marginTop: readerTopMargin,
                },
              ]}
              pointerEvents={isPanelOpen ? "none" : "auto"}
              onMessage={bridge.handleMessage}
              menuItems={[
                { key: "add-note", label: "Добавить заметку" },
                { key: "copy", label: "Скопировать" },
                { key: "translate", label: "Перевести" },
                { key: "summarize", label: "Кратко пересказать" },
                { key: "generate-scene", label: "Нарисовать сцену" },
                { key: "speak", label: "Озвучить" },
              ]}
              onCustomMenuSelection={handleSelectionMenuAction}
              onError={(e) => {
                console.error("[ReaderScreen] WebView error:", e.nativeEvent);
              }}
              onHttpError={(e) => {
                console.error("[ReaderScreen] WebView HTTP error:", e.nativeEvent);
              }}
              onContentProcessDidTerminate={() => {
                console.warn("[ReaderScreen] WebView content process terminated");
              }}
              javaScriptEnabled
              domStorageEnabled
              cacheEnabled={false}
              allowFileAccess
              allowFileAccessFromFileURLs
              allowUniversalAccessFromFileURLs
              allowsInlineMediaPlayback
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
              originWhitelist={["*"]}
              mixedContentMode="always"
            />
          </View>

          {/* Loading overlay */}
          {loading && (
            <View style={s.loadingOverlay}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}

          {/* ─── Top Info Bar (always visible) ─── */}
          {!showControls && showTopTitleProgress && (
            <View
              style={[s.topInfoBar, { top: layoutTopInset, paddingHorizontal: readerContentInset }]}
            >
              <View style={s.topInfoRow}>
                <Text style={s.topInfoText} numberOfLines={1}>
                  {currentChapter || bookTitle}
                </Text>
                {/* Номер страницы по всей книге (как в Apple Books); без
                    location (scrolled/fixed-layout) — процент прогресса */}
                {bookLocation ? (
                  <Text style={s.topInfoPageText}>
                    {t("reader.pageOfBook", "стр. {{current}} из {{total}}", {
                      current: Math.min(bookLocation.current + 1, bookLocation.total),
                      total: bookLocation.total,
                    })}
                  </Text>
                ) : (
                  <Text style={s.topInfoPageText}>{`${percent}%`}</Text>
                )}
              </View>
            </View>
          )}
        </Animated.View>

        {Platform.OS === "ios" && (
          <GestureDetector gesture={readerBackSwipeGesture}>
            <View
              collapsable={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: 24,
                zIndex: 20,
              }}
            />
          </GestureDetector>
        )}

        {readerToolbarDock}

        {/* ─── Bookmark Ribbon (top-right) ─── */}
        <BookmarkRibbon visible={isBookmarked} topOffset={0} rightOffset={readerContentInset} />

        {/* Note Tooltip (long-press on wavy underline) */}
        {adjustedNoteTooltip && (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                suppressReaderTapUntilRef.current = Date.now() + 350;
                if (noteTooltipTimer.current) {
                  clearTimeout(noteTooltipTimer.current);
                  noteTooltipTimer.current = null;
                }
                setNoteTooltip(null);
              }}
            />
            <Pressable
              style={[
                s.noteTooltip,
                {
                  left: Math.max(
                    NOTE_TOOLTIP_SIDE_PADDING,
                    Math.min(
                      adjustedNoteTooltip.position.x - NOTE_TOOLTIP_WIDTH / 2,
                      SCREEN_WIDTH - NOTE_TOOLTIP_WIDTH - NOTE_TOOLTIP_SIDE_PADDING,
                    ),
                  ),
                  ...(adjustedNoteTooltip.position.selectionTop > NOTE_TOOLTIP_TOP_THRESHOLD
                    ? {
                        bottom:
                          SCREEN_HEIGHT -
                          adjustedNoteTooltip.position.selectionTop +
                          NOTE_TOOLTIP_ABOVE_OFFSET,
                      }
                    : {
                        top:
                          adjustedNoteTooltip.position.selectionBottom + NOTE_TOOLTIP_BELOW_OFFSET,
                      }),
                },
              ]}
              onPress={(event) => {
                event.stopPropagation();
                suppressReaderTapUntilRef.current = Date.now() + 550;
              }}
              onPressIn={(event) => {
                event.stopPropagation();
                suppressReaderTapUntilRef.current = Date.now() + 550;
              }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderTerminationRequest={() => false}
            >
              <View style={s.noteTooltipContent}>
                <MarkdownRenderer
                  content={adjustedNoteTooltip.note || ""}
                  styleOverrides={noteTooltipMdStyles}
                />
              </View>
            </Pressable>
          </View>
        )}

        {/* ─── Единая панель: оглавление · закладки · поиск ─── */}
        <ReaderTOCPanel
          visible={showTOC}
          activeTab={tocActiveTab}
          toc={toc}
          bookmarks={bookBookmarks}
          currentChapter={currentChapter}
          isBookmarked={isBookmarked}
          searchQuery={search.searchQuery}
          searchResults={search.searchResults}
          searchResultCount={search.searchResultCount}
          isSearching={search.isSearching}
          searchTimedOut={search.searchTimedOut}
          onClose={() => setShowTOC(false)}
          onTabChange={setTocActiveTab}
          onSelectTocItem={goToTocItem}
          onGoToBookmark={(cfi) => {
            goToCFISafely(cfi);
            setShowTOC(false);
          }}
          onDeleteBookmark={(id) => removeBookmark(id)}
          onToggleBookmark={handleToggleBookmark}
          onSearchInput={search.handleSearchInput}
          onSubmitSearch={search.submitSearch}
          onSelectSearchResult={(cfi) => {
            // Переход к совпадению; подсветка найденного остаётся в тексте
            search.selectResult(cfi);
            setShowTOC(false);
          }}
        />

        {/* ─── Settings Panel ─── */}
        <ReaderSettingsPanel
          visible={showSettings}
          readSettings={readSettings}
          onClose={() => setShowSettings(false)}
          onUpdateSetting={updateSetting}
        />

        {/* ─── Notebook Panel ─── */}
        <Modal
          visible={showNotebook}
          transparent
          animationType="slide"
          onRequestClose={() => setShowNotebook(false)}
        >
          <Pressable style={s.modalBackdrop} onPress={() => setShowNotebook(false)} />
          <View
            style={[
              s.bottomSheet,
              { maxHeight: SCREEN_HEIGHT * 0.7, paddingBottom: insets.bottom || 16 },
            ]}
          >
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>{t("reader.notebook", "笔记本")}</Text>
              <TouchableOpacity onPress={() => setShowNotebook(false)}>
                <XIcon size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            {highlights.length > 0 ? (
              <ScrollView showsVerticalScrollIndicator={false} style={s.sheetScroll}>
                {highlights.map((h) => (
                  <View key={h.id} style={s.highlightItem}>
                    <View
                      style={[
                        s.highlightColorDot,
                        {
                          backgroundColor:
                            h.color === "yellow"
                              ? "#facc15"
                              : h.color === "green"
                                ? "#4ade80"
                                : h.color === "blue"
                                  ? "#60a5fa"
                                  : h.color === "pink"
                                    ? "#ec4899"
                                    : h.color === "red"
                                      ? "#f87171"
                                      : "#a78bfa",
                        },
                      ]}
                    />
                    <View style={s.highlightContent}>
                      <Text style={s.highlightText} numberOfLines={3}>
                        {h.text}
                      </Text>
                      {h.note && <Text style={s.highlightNote}>{h.note}</Text>}
                    </View>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={s.notebookPlaceholder}>
                <NotebookPenIcon size={40} color={colors.mutedForeground} />
                <Text style={s.notebookPlaceholderText}>
                  {t("reader.notebookHint", "在阅读时选中文字来创建笔记和高亮")}
                </Text>
              </View>
            )}
          </View>
        </Modal>

        {/* ─── Note View Modal ─── */}
        <ReaderNoteViewModal
          highlight={noteViewHighlight}
          editing={noteViewEditing}
          editContent={noteViewContent}
          bookId={bookId}
          onClose={() => {
            setNoteViewHighlight(null);
            setNoteViewEditing(false);
          }}
          onStartEdit={() => {
            setNoteViewContent(noteViewHighlight?.note || "");
            setNoteViewEditing(true);
          }}
          onCancelEdit={() => {
            setNoteViewEditing(false);
            setNoteViewContent(noteViewHighlight?.note || "");
          }}
          onContentChange={setNoteViewContent}
          onSave={(highlight, newNote) => {
            bridge.removeAnnotation({ value: highlight.cfi });
            bridge.addAnnotation({
              value: highlight.cfi,
              type: "highlight",
              color: highlight.color,
              note: newNote,
            });
            setNoteViewHighlight({ ...highlight, note: newNote });
            setNoteViewEditing(false);
          }}
        />

        {/* ─── Translation Panel ─── */}
        {showTranslation && translationText && (
          <TranslationPanel
            text={translationText}
            onClose={() => {
              setShowTranslation(false);
              setTranslationText("");
            }}
          />
        )}

        {/* ─── Chapter Translation Sheet ─── */}
        <ChapterTranslationSheet
          visible={showChapterTranslation}
          onClose={() => setShowChapterTranslation(false)}
          state={chapterTranslation.state}
          onStart={chapterTranslation.startTranslation}
          onCancel={chapterTranslation.cancelTranslation}
          onToggleOriginalVisible={chapterTranslation.toggleOriginalVisible}
          onToggleTranslationVisible={chapterTranslation.toggleTranslationVisible}
          onReset={chapterTranslation.reset}
        />

        <TTSPage
          visible={showTTS}
          bookTitle={bookTitle || book?.meta.title || ""}
          chapterTitle={currentChapter}
          coverUri={tts.ttsCoverUri}
          playState={ttsPlayState}
          currentText={tts.currentTTSSegment?.text || tts.ttsLastText}
          config={ttsConfig}
          readingProgress={progress}
          currentPage={currentPage}
          totalPages={totalPages}
          sourceLabel={tts.ttsSourceLabel}
          continuousEnabled={tts.ttsContinuousEnabled}
          narrationSegments={tts.ttsDisplaySegments}
          prevNarrationSegments={tts.ttsPrevPageSegments}
          currentSegmentCfi={tts.resolvedTTSSegmentCfi}
          currentSegmentText={tts.currentTTSSegment?.text || null}
          currentChunkIndex={tts.localTTSChunkIndex}
          totalChunks={tts.ttsDisplaySegments.length}
          chapterCurrentIndex={tts.currentTTSChapterSegmentIndex}
          chapterTotalChunks={tts.ttsChapterSegments.length}
          onClose={() => setShowTTS(false)}
          onReturnToReading={tts.handleTTSReturnToReading}
          onReplay={tts.handleTTSReplay}
          onPlayPause={tts.handleTTSPlayPause}
          onJumpToSegment={tts.handleJumpToTTSSegment}
          onJumpToLyricSegment={tts.handleJumpToTTSLyricSegment}
          onLoadMoreAbove={tts.handleLoadMoreAboveTTSLyrics}
          onLoadMoreBelow={tts.handleLoadMoreBelowTTSLyrics}
          onSeekChapterChunk={tts.handleSeekTTSChapterSegment}
          onStop={tts.handleTTSStop}
          onAdjustRate={tts.handleAdjustTTSRate}
          onAdjustPitch={tts.handleAdjustTTSPitch}
          onToggleContinuous={tts.handleToggleTTSContinuous}
          onUpdateConfig={tts.handleUpdateTTSConfig}
          onPrevChapter={toc.length > 0 ? tts.handleTTSPrevChapter : undefined}
          onNextChapter={toc.length > 0 ? tts.handleTTSNextChapter : undefined}
        />

        {/* ─── Карточка героя (тап по имени в тексте) ─── */}
        <ReaderCharacterCard
          visible={!!characterCard}
          character={characterCard}
          bookId={bookId}
          onClose={() => setCharacterCard(null)}
          onOpenChat={handleOpenCharacterChat}
        />
      </View>
    </>
  );
}
