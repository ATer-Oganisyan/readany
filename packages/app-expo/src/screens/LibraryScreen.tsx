import { BookCard } from "@/components/library/BookCard";
import { CatalogBookCard } from "@/components/library/CatalogBookCard";
import { GroupCard } from "@/components/library/GroupCard";
import { GroupPickerSheet } from "@/components/library/GroupPickerSheet";
import { ImportSourceMenuButton } from "@/components/library/ImportSourceMenuButton";
import { ReadingNowShelf } from "@/components/library/ReadingNowShelf";
import { type ExtractorRef, ExtractorWebView } from "@/components/rag/ExtractorWebView";
import {
  CheckCheckIcon,
  ChevronLeftIcon,
  DatabaseIcon,
  FolderInputIcon,
  FolderMinusIcon,
  HashIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { NativeButton } from "@/components/ui/NativeButton";
import { ScrollViewMarker } from "@/components/ui/ScrollViewMarker";
import { SyncButton } from "@/components/ui/SyncButton";
import { Text, TextInput } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import {
  BUNDLED_CATALOG_BOOKS,
  type BundledCatalogBook,
  normalizeCatalogIdentity,
} from "@/lib/catalog/bundled-books";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import { queueBookForAutoVectorize } from "@/lib/rag/auto-vectorize-book";
import { setCallback, setExtractorRef } from "@/lib/rag/auto-vectorize-service";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { NATIVE_SCROLL_EDGE_EFFECTS } from "@/navigation/scroll-edge-effects";
import { useLibraryStore } from "@/stores/library-store";
import { useVectorModelStore } from "@/stores/vector-model-store";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  secondLevelTitleFontFamily,
  useColors,
} from "@/styles/theme";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getPlatformService } from "@readany/core";
import { setFallbackContentProvider } from "@readany/core/ai";
import { onLibraryChanged } from "@readany/core/events/library-events";
import { useSyncStore } from "@readany/core/stores";
import type { Book, BookGroup } from "@readany/core/types";
import * as DocumentPicker from "expo-document-picker";
import { File as ExpoFile, Paths } from "expo-file-system";
/**
 * LibraryScreen — matching Tauri mobile LibraryPage exactly.
 * Features: header sort/import, tag filter, vectorization progress banner,
 * tag management sheet, responsive book grid, empty/loading states.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import ReadAnyNativeControls from "../../modules/native-controls";
import { TagManagementSheet } from "./library/TagManagementSheet";
import { useBookDownload } from "./library/useBookDownload";
import { useVectorizationQueue } from "./library/useVectorizationQueue";

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

type Nav = NativeStackNavigationProp<RootStackParamList>;

const NUM_COLUMNS = 2;
const GRID_GAP = 16;
const URL_IMPORT_EXTENSIONS = new Set([
  "epub",
  "pdf",
  "mobi",
  "azw",
  "azw3",
  "cbz",
  "cbr",
  "fb2",
  "fbz",
  "txt",
  "umd",
]);

function getUrlImportFilename(url: URL): string {
  const rawName = decodeURIComponent(url.pathname.split("/").pop() || "").trim();
  const safeName = rawName.replace(/[\\/:*?"<>|\[\]{}#%&]/g, "_");
  const extension = safeName.split(".").pop()?.toLowerCase();

  if (!safeName || !extension || !URL_IMPORT_EXTENSIONS.has(extension)) {
    throw new Error("unsupported-url");
  }

  return safeName;
}

type LibraryGridItem =
  | { type: "group"; group: BookGroup; books: Book[] }
  | { type: "book"; book: Book };

type LibrarySection = "catalog" | "my-books";

export function LibraryScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const nativeHeaderHeight = useHeaderHeight();
  const layout = useResponsiveLayout();
  const gridGap = layout.isTablet ? 16 : GRID_GAP;
  const columnCount = layout.isTabletLandscape ? 5 : layout.isTablet ? 4 : NUM_COLUMNS;
  const contentWidth = layout.centeredContentWidth;
  const gridItemWidth = Math.floor((contentWidth - gridGap * (columnCount - 1)) / columnCount);
  const s = useMemo(
    () =>
      makeStyles(colors, {
        horizontalPadding: layout.horizontalPadding,
        contentWidth,
        gridGap,
        gridItemWidth,
        isWideScreen: layout.isTablet,
      }),
    [colors, contentWidth, gridGap, gridItemWidth, layout.horizontalPadding, layout.isTablet],
  );
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [tagSheetBook, setTagSheetBook] = useState<Book | null>(null);
  const [isPickingImport, setIsPickingImport] = useState(false);
  const [isUrlImporting, setIsUrlImporting] = useState(false);
  const [librarySection, setLibrarySection] = useState<LibrarySection>("catalog");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [batchTagBookIds, setBatchTagBookIds] = useState<string[]>([]);
  const [groupNameModal, setGroupNameModal] = useState<{
    mode: "create" | "rename";
    group?: BookGroup;
  } | null>(null);
  const [groupNameInput, setGroupNameInput] = useState("");
  const localImportInFlightRef = useRef(false);

  const extractorRef = useRef<ExtractorRef>(null);

  const {
    books,
    groups,
    isLoaded,
    isImporting,
    filter,
    allTags,
    activeTag,
    activeGroupId,
    isGroupView,
    loadBooks,
    importBooks,
    removeBook,
    setGroupView,
    setActiveGroupId,
    setActiveTag,
    addTag,
    addGroup,
    renameGroup,
    removeGroup,
    moveBooksToGroup,
    addTagToBook,
    removeTagFromBook,
    removeTag,
    renameTag,
  } = useLibraryStore();
  const hasBooks = books.length > 0;
  const syncNow = useSyncStore((state) => state.syncNow);
  const syncStatus = useSyncStore((state) => state.status);
  const syncBackendType = useSyncStore((state) => state.backendType);
  const isSyncBusy = syncStatus !== "idle" && syncStatus !== "error";

  const { downloadingBookId, downloadProgress, downloadBook } = useBookDownload({
    loadBooks,
    // Download finishes silently — user can re-tap the book to open it.
    onSuccess: () => {},
  });

  const { vectorQueue, vectorizingBookId, vectorProgress, handleVectorize } = useVectorizationQueue(
    { extractorRef, nav },
  );

  useEffect(() => {
    if (isLoaded && !hasBooks && librarySection !== "catalog") {
      setLibrarySection("catalog");
    }
  }, [hasBooks, isLoaded, librarySection]);

  useEffect(() => {
    let cancelled = false;

    const loadAndRepairVectorIndex = async () => {
      await loadBooks();

      const hydrationDeadline = Date.now() + 10_000;
      while (!useVectorModelStore.getState()._hasHydrated && Date.now() < hydrationDeadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      if (cancelled) return;

      const vectorState = useVectorModelStore.getState();
      if (
        !vectorState._hasHydrated ||
        !vectorState.autoVectorizeOnImport ||
        !vectorState.vectorModelEnabled ||
        !vectorState.hasVectorCapability()
      ) {
        return;
      }

      const unindexedBooks = useLibraryStore.getState().books.filter((book) => !book.isVectorized);
      for (const book of unindexedBooks) {
        if (cancelled) return;
        try {
          await queueBookForAutoVectorize(book);
        } catch (error) {
          console.warn(`[AutoVectorize] Failed to queue existing book ${book.meta.title}:`, error);
        }
      }
    };

    void loadAndRepairVectorIndex();
    return () => {
      cancelled = true;
    };
  }, [loadBooks]);
  useEffect(() => {
    setExtractorRef(extractorRef.current);
    setFallbackContentProvider({
      async getChapters(book) {
        if (!extractorRef.current) throw new Error("Mobile fallback extractor is not ready");
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const filePath =
          book.filePath.startsWith("/") ||
          book.filePath.startsWith("file://") ||
          book.filePath.startsWith("asset://") ||
          book.filePath.startsWith("http")
            ? book.filePath
            : await platform.joinPath(appData, book.filePath);
        if (/^https?:\/\//i.test(filePath)) {
          throw new Error("Mobile original-file search requires a local book file");
        }

        const file = new ExpoFile(filePath);
        if (!file.exists) throw new Error("Book file is not available on this device");

        const bytes = await platform.readFile(filePath);
        const mimeTypes: Record<string, string> = {
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
        return extractorRef.current.extractChapters(
          bytesToBase64(bytes),
          mimeTypes[String(book.format || "").toLowerCase()] || "application/epub+zip",
        );
      },
    });
    setCallback((bookId, progress) => {
      console.log(
        `[AutoVectorize] Book ${bookId}: ${progress.status} (${Math.round(progress.progress * 100)}%)`,
      );
    });
    return () => {
      setExtractorRef(null);
      setFallbackContentProvider(null);
      setCallback(null);
    };
  }, []);

  useEffect(() => {
    return onLibraryChanged((deletedTags) => loadBooks(deletedTags));
  }, [loadBooks]);

  const filteredBooks = useMemo(() => {
    let result = [...books];
    if (activeTag === "__uncategorized__") {
      result = result.filter((b) => b.tags.length === 0);
    } else if (activeTag) {
      result = result.filter((b) => b.tags.includes(activeTag));
    }
    if (activeGroupId) {
      result = result.filter((b) => b.groupId === activeGroupId);
    }
    const { sortField, sortOrder } = filter;
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title":
          cmp = a.meta.title.localeCompare(b.meta.title);
          break;
        case "author":
          cmp = (a.meta.author || "").localeCompare(b.meta.author || "");
          break;
        case "addedAt":
          cmp = (a.addedAt || 0) - (b.addedAt || 0);
          break;
        case "lastOpenedAt":
          cmp = (a.lastOpenedAt || 0) - (b.lastOpenedAt || 0);
          break;
        case "progress":
          cmp = a.progress - b.progress;
          break;
      }
      return sortOrder === "desc" ? -cmp : cmp;
    });
    return result;
  }, [books, filter, activeTag, activeGroupId]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? null,
    [groups, activeGroupId],
  );

  useLayoutEffect(() => {
    const title = selectionMode
      ? t("library.selectedCount", {
          count: selectedBookIds.size,
          defaultValue: "Выбрано: {{count}}",
        })
      : activeGroup?.name || t("tabs.library", "Библиотека");

    nav.setOptions({
      title,
      headerTitle: title,
    });
  }, [activeGroup?.name, nav, selectedBookIds.size, selectionMode, t]);

  const groupedEntries = useMemo(() => {
    return groups
      .map((group) => {
        const groupBooks = filteredBooks.filter((book) => book.groupId === group.id);
        return { type: "group" as const, group, books: groupBooks };
      })
      .filter((item) => item.books.length > 0);
  }, [filteredBooks, groups]);

  const visibleBooks = useMemo(
    () =>
      isGroupView && !activeGroupId ? filteredBooks.filter((book) => !book.groupId) : filteredBooks,
    [activeGroupId, filteredBooks, isGroupView],
  );

  const gridItems = useMemo<LibraryGridItem[]>(
    () =>
      isGroupView && !activeGroupId
        ? [...groupedEntries, ...visibleBooks.map((book) => ({ type: "book" as const, book }))]
        : visibleBooks.map((book) => ({ type: "book" as const, book })),
    [activeGroupId, groupedEntries, isGroupView, visibleBooks],
  );

  const catalogBooksInLibrary = useMemo(() => {
    const result = new Map<string, Book>();
    for (const catalogBook of BUNDLED_CATALOG_BOOKS) {
      const catalogTitle = normalizeCatalogIdentity(catalogBook.title);
      const existingBook = books.find(
        (book) => normalizeCatalogIdentity(book.meta.title) === catalogTitle,
      );
      if (existingBook) result.set(catalogBook.id, existingBook);
    }
    return result;
  }, [books]);

  const showCatalog = !activeTag && !activeGroupId && !selectionMode;

  // «Читаю сейчас»: все незаконченные книги, включая только что открытые с 0%.
  // ReaderScreen обновляет lastOpenedAt при открытии, поэтому открытая книга
  // автоматически перемещается в начало карусели.
  const readingNowBooks = useMemo(
    () =>
      books
        .filter((book) => !book.deletedAt && book.progress < 1)
        .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)),
    [books],
  );
  const showReadingNow =
    !activeTag && !activeGroupId && !selectionMode && readingNowBooks.length > 0;

  // Книги из «Читаю сейчас» не дублируем в сетке ниже
  const displayGridItems = useMemo(() => {
    if (!showReadingNow) return gridItems;
    const readingIds = new Set(readingNowBooks.map((book) => book.id));
    return gridItems.filter((item) => item.type !== "book" || !readingIds.has(item.book.id));
  }, [gridItems, readingNowBooks, showReadingNow]);

  const visibleGridItems = useMemo(() => {
    if (!showCatalog) return displayGridItems;
    return librarySection === "my-books" ? gridItems : [];
  }, [displayGridItems, gridItems, librarySection, showCatalog]);

  const handleLocalImport = useCallback(async () => {
    if (localImportInFlightRef.current) return;
    localImportInFlightRef.current = true;
    setIsPickingImport(true);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/epub+zip",
          "application/pdf",
          "application/x-mobipocket-ebook",
          "application/vnd.amazon.ebook",
          "application/vnd.comicbook+zip",
          "application/x-fictionbook+xml",
          "text/plain",
          "application/octet-stream",
        ],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const files = result.assets.map((a) => ({ uri: a.uri, name: a.name }));
      const summary = await importBooks(files);
      if (summary.imported.length === 0 || summary.failures.length > 0) {
        Alert.alert(
          t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"),
          t("library.importResultSummary", {
            imported: summary.imported.length,
            skipped: summary.skippedDuplicates.length,
            failed: summary.failures.length,
          }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("Different document picking in progress")) {
        console.error("Import failed:", err);
      }
    } finally {
      localImportInFlightRef.current = false;
      setIsPickingImport(false);
    }
  }, [importBooks, t]);

  const handleUrlImport = useCallback(
    async (rawValue: string) => {
      const value = rawValue.trim();
      let temporaryFile: ExpoFile | null = null;

      try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          throw new Error("invalid-url");
        }

        // Фанфики Фикбука качаются и собираются в EPUB отдельным модулем (P11);
        // динамический импорт, чтобы не грузить парсер при обычном импорте.
        const ficbook = await import("@/lib/book/import-ficbook");
        if (ficbook.parseFicbookUrl(value)) {
          setIsUrlImporting(true);
          const fanfic = await ficbook.importFicbookFromUrl(value);
          temporaryFile = new ExpoFile(Paths.cache, `readany-ficbook-${Date.now()}.epub`);
          if (temporaryFile.exists) {
            temporaryFile.delete();
          }
          temporaryFile.write(fanfic.epubBytes);
          const ficbookSummary = await importBooks([
            { uri: temporaryFile.uri, name: fanfic.fileName },
          ]);
          if (ficbookSummary.imported.length === 0 || ficbookSummary.failures.length > 0) {
            Alert.alert(
              t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"),
              t("library.importResultSummary", {
                imported: ficbookSummary.imported.length,
                skipped: ficbookSummary.skippedDuplicates.length,
                failed: ficbookSummary.failures.length,
              }),
            );
          }
          return;
        }

        const fileName = getUrlImportFilename(url);
        temporaryFile = new ExpoFile(Paths.cache, `readany-url-${Date.now()}-${fileName}`);
        setIsUrlImporting(true);
        const downloadedFile = await ExpoFile.downloadFileAsync(url.toString(), temporaryFile, {
          idempotent: true,
        });
        const summary = await importBooks([{ uri: downloadedFile.uri, name: fileName }]);

        if (summary.imported.length === 0 || summary.failures.length > 0) {
          Alert.alert(
            t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"),
            t("library.importResultSummary", {
              imported: summary.imported.length,
              skipped: summary.skippedDuplicates.length,
              failed: summary.failures.length,
            }),
          );
        }
      } catch (error) {
        const errorCode = error instanceof Error ? error.message : "";
        const message =
          errorCode === "ficbook-blocked"
            ? t(
                "library.importSourceUrlFicbookBlocked",
                "Фикбук временно блокирует автоматический доступ — попробуйте позже.",
              )
            : errorCode === "ficbook-not-found"
              ? t(
                  "library.importSourceUrlFicbookNotFound",
                  "Фанфик по этой ссылке не найден. Проверьте адрес и попробуйте снова.",
                )
              : errorCode === "unsupported-url"
                ? t(
                    "library.importSourceUrlUnsupported",
                    "Нужна прямая ссылка на файл EPUB, PDF, TXT или другого поддерживаемого формата — либо ссылка на фанфик Фикбука.",
                  )
                : t(
                    "library.importSourceUrlError",
                    "Проверьте ссылку и подключение к интернету, затем попробуйте снова.",
                  );
        Alert.alert(
          t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"),
          message,
        );
      } finally {
        setIsUrlImporting(false);
        if (temporaryFile?.exists) {
          temporaryFile.delete();
        }
      }
    },
    [importBooks, t],
  );

  const handleOpenUrlImport = useCallback(async () => {
    try {
      const value = await ReadAnyNativeControls.promptForText(
        t("library.importSourceUrlTitle", "Ссылка на книгу"),
        t("library.importSourceUrlDesc", "Вставьте ссылку на файл книги или на фанфик Фикбука."),
        t("library.importSourceUrlPlaceholder", "Ссылка на файл или фанфик Фикбука"),
        t("common.cancel", "Отмена"),
        t("library.importSourceUrlSubmit", "Добавить"),
      );
      if (value?.trim()) {
        await handleUrlImport(value);
      }
    } catch (error) {
      console.error("Native URL prompt failed:", error);
      Alert.alert(
        t("library.importSourceUrlErrorTitle", "Не получилось добавить книгу"),
        t("library.importSourceUrlError", "Проверьте ссылку и попробуйте снова."),
      );
    }
  }, [handleUrlImport, t]);

  const handleOpenImportSources = useCallback(() => {
    Alert.alert(t("library.importFirst", "Добавить книгу"), undefined, [
      {
        text: t("library.importSourceUrl", "Найти по ссылке"),
        onPress: () => void handleOpenUrlImport(),
      },
      {
        text: t("library.importSourceLocal", "Выбрать файл"),
        onPress: () => void handleLocalImport(),
      },
      { text: t("common.cancel", "Отмена"), style: "cancel" },
    ]);
  }, [handleLocalImport, handleOpenUrlImport, t]);

  const handleOpen = useCallback(
    async (book: Book) => {
      if (book.syncStatus === "remote") {
        await downloadBook(book);
        return;
      }
      await openMobileBook({ bookId: book.id, navigation: nav, t });
    },
    [downloadBook, nav, t],
  );

  const handleCatalogOpen = useCallback(
    async (catalogBook: BundledCatalogBook) => {
      const existingBook = catalogBooksInLibrary.get(catalogBook.id);
      if (existingBook) {
        await handleOpen(existingBook);
        return;
      }
      nav.navigate("Reader", {
        bookId: `catalog:${catalogBook.id}`,
        catalogBookId: catalogBook.id,
      });
    },
    [catalogBooksInLibrary, handleOpen, nav],
  );

  const handleManageTags = useCallback((book: Book) => {
    setTagSheetBook(book);
    setTagSheetOpen(true);
  }, []);

  const handleSync = useCallback(() => {
    if (!isSyncBusy) void syncNow();
  }, [isSyncBusy, syncNow]);

  useLayoutEffect(() => {
    if (selectionMode) {
      nav.setOptions(
        Platform.OS === "ios"
          ? { unstable_headerRightItems: () => [] }
          : { headerRight: () => null },
      );
      return;
    }

    if (Platform.OS === "ios") {
      nav.setOptions({
        unstable_headerRightItems: () => [
          ...(syncBackendType
            ? [
                {
                  type: "button" as const,
                  label: t("sync.syncNow", "Синхронизировать"),
                  accessibilityLabel: t("sync.syncNow", "Синхронизировать"),
                  icon: { type: "sfSymbol" as const, name: "arrow.clockwise" as const },
                  disabled: isSyncBusy,
                  onPress: handleSync,
                },
              ]
            : []),
          {
            type: "menu" as const,
            label: t("library.importFirst", "Добавить книгу"),
            accessibilityLabel: t("library.importFirst", "Добавить книгу"),
            icon: { type: "sfSymbol" as const, name: "plus" as const },
            disabled: isImporting || isPickingImport,
            menu: {
              items: [
                {
                  type: "action" as const,
                  label: t("library.importSourceUrl", "Найти по ссылке"),
                  icon: { type: "sfSymbol" as const, name: "link" as const },
                  onPress: handleOpenUrlImport,
                },
                {
                  type: "action" as const,
                  label: t("library.importSourceLocal", "Выбрать файл"),
                  icon: { type: "sfSymbol" as const, name: "folder" as const },
                  onPress: () => void handleLocalImport(),
                },
              ],
            },
          },
        ],
      });
      return;
    }

    nav.setOptions({
      headerRight: () => (
        <View style={s.nativeHeaderActions}>
          {syncBackendType ? (
            <View style={s.nativeHeaderButton}>
              <SyncButton size={20} color={colors.mutedForeground} />
            </View>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t("library.importFirst", "Добавить книгу")}
            style={s.nativeHeaderButton}
            onPress={handleOpenImportSources}
            disabled={isImporting || isPickingImport}
            activeOpacity={0.65}
          >
            <PlusIcon size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [
    colors.mutedForeground,
    colors.primary,
    handleLocalImport,
    handleOpenImportSources,
    handleOpenUrlImport,
    handleSync,
    isImporting,
    isPickingImport,
    isSyncBusy,
    nav,
    s.nativeHeaderActions,
    s.nativeHeaderButton,
    selectionMode,
    syncBackendType,
    t,
  ]);

  const isEmpty = gridItems.length === 0;

  const toggleBookSelection = useCallback((book: Book) => {
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(book.id)) next.delete(book.id);
      else next.add(book.id);
      return next;
    });
  }, []);

  const enterSelectionMode = useCallback((book: Book) => {
    setSelectionMode(true);
    setSelectedBookIds(new Set([book.id]));
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedBookIds(new Set());
  }, []);

  const isAllSelected = visibleBooks.length > 0 && selectedBookIds.size === visibleBooks.length;

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedBookIds(new Set());
    } else {
      setSelectedBookIds(new Set(visibleBooks.map((b) => b.id)));
    }
  }, [visibleBooks, isAllSelected]);

  const handleBatchDelete = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    Alert.alert(
      t("common.confirm", "确认"),
      t("library.batchDeleteConfirm", `确定要删除选中的 ${selectedBookIds.size} 本书吗？`),
      [
        { text: t("common.cancel", "取消"), style: "cancel" },
        {
          text: t("common.delete", "删除"),
          style: "destructive",
          onPress: async () => {
            for (const id of selectedBookIds) {
              await removeBook(id);
            }
            exitSelectionMode();
          },
        },
      ],
    );
  }, [selectedBookIds, removeBook, exitSelectionMode, t]);

  const handleBatchTag = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    const selectedBooks = books.filter((b) => selectedBookIds.has(b.id));
    setTagSheetBook(selectedBooks[0] ?? null);
    setBatchTagBookIds([...selectedBookIds]);
    setTagSheetOpen(true);
  }, [selectedBookIds, books]);

  const handleBatchVectorize = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    const selectedBooks = books.filter((b) => selectedBookIds.has(b.id));
    for (const book of selectedBooks) {
      handleVectorize(book);
    }
    exitSelectionMode();
  }, [selectedBookIds, books, handleVectorize, exitSelectionMode]);

  const openGroupNameModal = useCallback((mode: "create" | "rename", group?: BookGroup) => {
    setGroupNameInput(group?.name ?? "");
    setGroupNameModal({ mode, group });
  }, []);

  const submitGroupName = useCallback(async () => {
    const trimmed = groupNameInput.trim();
    if (!trimmed || !groupNameModal) return;
    if (groupNameModal.mode === "create") {
      await addGroup(trimmed);
      setGroupView(true);
    } else if (groupNameModal.group) {
      renameGroup(groupNameModal.group.id, trimmed);
    }
    setGroupNameInput("");
    setGroupNameModal(null);
  }, [addGroup, groupNameInput, groupNameModal, renameGroup, setGroupView]);

  const handleGroupLongPress = useCallback(
    (group: BookGroup) => {
      Alert.alert(group.name, undefined, [
        {
          text: t("common.rename", "重命名"),
          onPress: () => openGroupNameModal("rename", group),
        },
        {
          text: t("common.delete", "删除"),
          style: "destructive",
          onPress: () => void removeGroup(group.id),
        },
        { text: t("common.cancel", "取消"), style: "cancel" },
      ]);
    },
    [openGroupNameModal, removeGroup, t],
  );

  const handleBatchMoveGroup = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    setShowGroupPicker(true);
  }, [selectedBookIds]);

  const handleGroupPickerSelect = useCallback(
    (groupId: string | undefined) => {
      moveBooksToGroup([...selectedBookIds], groupId);
      exitSelectionMode();
    },
    [exitSelectionMode, moveBooksToGroup, selectedBookIds],
  );

  const handleGroupPickerCreate = useCallback(
    async (name: string) => {
      const group = await addGroup(name);
      if (group) {
        moveBooksToGroup([...selectedBookIds], group.id);
        exitSelectionMode();
      }
    },
    [addGroup, exitSelectionMode, moveBooksToGroup, selectedBookIds],
  );

  const handleBatchRemoveFromGroup = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    moveBooksToGroup([...selectedBookIds], undefined);
    exitSelectionMode();
  }, [exitSelectionMode, moveBooksToGroup, selectedBookIds]);

  const renderGridItem = useCallback(
    ({ item }: { item: LibraryGridItem }) => (
      <View style={s.gridItem}>
        {item.type === "group" ? (
          <GroupCard
            group={item.group}
            books={item.books}
            cardWidth={gridItemWidth}
            onOpen={setActiveGroupId}
            onLongPress={handleGroupLongPress}
          />
        ) : (
          <BookCard
            book={item.book}
            cardWidth={gridItemWidth}
            onOpen={handleOpen}
            onDelete={removeBook}
            onManageTags={handleManageTags}
            onVectorize={handleVectorize}
            isVectorizing={vectorizingBookId === item.book.id}
            isQueued={vectorQueue.some((b) => b.id === item.book.id)}
            vectorProgress={vectorizingBookId === item.book.id ? vectorProgress : null}
            downloadProgress={downloadingBookId === item.book.id ? downloadProgress : null}
            isSelectionMode={selectionMode}
            isSelected={selectedBookIds.has(item.book.id)}
            onSelect={toggleBookSelection}
            onLongPress={selectionMode ? undefined : enterSelectionMode}
          />
        )}
      </View>
    ),
    [
      enterSelectionMode,
      gridItemWidth,
      handleGroupLongPress,
      handleManageTags,
      handleOpen,
      handleVectorize,
      removeBook,
      s.gridItem,
      selectedBookIds,
      selectionMode,
      setActiveGroupId,
      toggleBookSelection,
      vectorProgress,
      vectorQueue,
      vectorizingBookId,
      downloadingBookId,
      downloadProgress,
    ],
  );

  const listHeader = (
    <>
      {/* Contextual bulk/group controls stay in content; primary actions live in native header. */}
      {(selectionMode || activeGroup) && (
        <View style={[s.header, { zIndex: 20 }]}>
          <View style={s.headerInner}>
            {selectionMode ? (
              <View style={s.headerRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TouchableOpacity style={s.headerBtn} onPress={exitSelectionMode}>
                    <XIcon size={18} color={colors.foreground} />
                  </TouchableOpacity>
                </View>
                <View style={s.headerActions}>
                  <TouchableOpacity style={s.headerBtn} onPress={toggleSelectAll}>
                    <CheckCheckIcon
                      size={18}
                      color={isAllSelected ? colors.primary : colors.mutedForeground}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.headerBtn} onPress={handleBatchTag}>
                    <HashIcon size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.headerBtn} onPress={handleBatchMoveGroup}>
                    <FolderInputIcon size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                  {activeGroupId ? (
                    <TouchableOpacity style={s.headerBtn} onPress={handleBatchRemoveFromGroup}>
                      <FolderMinusIcon size={18} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={s.headerBtn} onPress={handleBatchVectorize}>
                    <DatabaseIcon size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.headerBtn} onPress={handleBatchDelete}>
                    <Trash2Icon size={18} color={colors.destructive} />
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={s.headerRow}>
                <TouchableOpacity style={s.headerBtn} onPress={() => setActiveGroupId("")}>
                  <ChevronLeftIcon size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      )}

      {hasBooks && allTags.length > 0 && (
        <View style={s.filterSection}>
          <View style={s.headerInner}>
            <View style={s.tagSection}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={[s.tagScroll, layout.isTablet ? s.tagScrollWide : null]}
                contentContainerStyle={s.tagScrollContent}
              >
                <TouchableOpacity
                  style={[s.tagChip, !activeTag && !activeGroupId && s.tagChipActive]}
                  onPress={() => setActiveTag("")}
                >
                  <Text
                    style={[s.tagChipText, !activeTag && !activeGroupId && s.tagChipTextActive]}
                  >
                    {t("library.all", "全部")}
                  </Text>
                </TouchableOpacity>
                {allTags.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={[s.tagChip, activeTag === tag && s.tagChipActive]}
                    onPress={() => setActiveTag(activeTag === tag ? "" : tag)}
                  >
                    <Text style={[s.tagChipText, activeTag === tag && s.tagChipTextActive]}>
                      {tag}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[s.tagChip, activeTag === "__uncategorized__" && s.tagChipActive]}
                  onPress={() =>
                    setActiveTag(activeTag === "__uncategorized__" ? "" : "__uncategorized__")
                  }
                >
                  <Text
                    style={[
                      s.tagChipText,
                      activeTag === "__uncategorized__" && s.tagChipTextActive,
                    ]}
                  >
                    {t("sidebar.uncategorized", "未分类")}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </View>
      )}

      {isLoaded && showReadingNow ? (
        <ReadingNowShelf
          books={readingNowBooks}
          edgeInset={layout.horizontalPadding}
          catalogCardWidth={gridItemWidth}
          onDelete={removeBook}
          onOpen={handleOpen}
        />
      ) : null}

      {isLoaded && showCatalog ? (
        <View accessibilityRole="tablist" style={s.librarySectionTabs}>
          <Pressable
            accessible
            accessibilityLabel={t("library.catalog", "Каталог")}
            accessibilityRole="button"
            accessibilityState={{ selected: librarySection === "catalog" }}
            hitSlop={8}
            onPress={() => setLibrarySection("catalog")}
            style={({ pressed }) => pressed && s.librarySectionTabPressed}
          >
            <Text
              style={[
                s.librarySectionTabText,
                librarySection === "catalog" && s.librarySectionTabTextActive,
              ]}
            >
              {t("library.catalog", "Каталог")}
            </Text>
          </Pressable>
          {hasBooks ? (
            <Pressable
              accessible
              accessibilityLabel={t("library.myBooks", "Мои книги")}
              accessibilityRole="button"
              accessibilityState={{ selected: librarySection === "my-books" }}
              hitSlop={8}
              onPress={() => setLibrarySection("my-books")}
              style={({ pressed }) => pressed && s.librarySectionTabPressed}
            >
              <Text
                style={[
                  s.librarySectionTabText,
                  librarySection === "my-books" && s.librarySectionTabTextActive,
                ]}
              >
                {t("library.myBooks", "Мои книги")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </>
  );

  return (
    <>
      <ScrollViewMarker style={s.container} scrollEdgeEffects={NATIVE_SCROLL_EDGE_EFFECTS}>
        <FlatList
          data={isLoaded ? visibleGridItems : []}
          renderItem={renderGridItem}
          style={s.primaryScroll}
          removeClippedSubviews={false}
          contentInsetAdjustmentBehavior="automatic"
          alwaysBounceVertical
          extraData={{ vectorProgress, vectorizingBookId }}
          keyExtractor={(item) => (item.type === "group" ? `group-${item.group.id}` : item.book.id)}
          key={`library-grid-${columnCount}`}
          numColumns={columnCount}
          columnWrapperStyle={s.gridRow}
          contentContainerStyle={
            isLoaded && (!isEmpty || showCatalog) ? s.gridContent : s.emptyScrollContent
          }
          ListEmptyComponent={
            !isLoaded ? null : books.length === 0 && !showCatalog ? (
              <CenteredEmptyState
                title={t("library.empty", "暂无书籍")}
                description={t("library.emptyHint", "导入电子书开始阅读之旅")}
                avoidNativeTabBar
              >
                <ImportSourceMenuButton
                  label={t("library.importFirst", "Добавить книгу")}
                  urlLabel={t("library.importSourceUrl", "Найти по ссылке")}
                  localLabel={t("library.importSourceLocal", "Выбрать файл")}
                  disabled={isPickingImport || isUrlImporting}
                  onUrlPress={handleOpenUrlImport}
                  onLocalPress={() => void handleLocalImport()}
                  onFallbackPress={handleOpenImportSources}
                />
              </CenteredEmptyState>
            ) : hasBooks && isEmpty && !showCatalog ? (
              <View
                style={[s.noResultsWrap, { transform: [{ translateY: -nativeHeaderHeight / 2 }] }]}
              >
                <Text style={s.noResultsText}>{t("library.noResults", "没有找到匹配的书籍")}</Text>
              </View>
            ) : null
          }
          ListHeaderComponent={listHeader}
          ListFooterComponent={
            isLoaded && showCatalog && librarySection === "catalog" ? (
              <View style={s.catalogSection}>
                <View style={s.catalogGrid}>
                  {BUNDLED_CATALOG_BOOKS.map((catalogBook) => (
                    <View key={catalogBook.id} style={s.gridItem}>
                      <CatalogBookCard
                        title={catalogBook.title}
                        author={catalogBook.author}
                        coverAssetModule={catalogBook.coverAssetModule}
                        cardWidth={gridItemWidth}
                        isImporting={false}
                        isInLibrary={catalogBooksInLibrary.has(catalogBook.id)}
                        onPress={() => void handleCatalogOpen(catalogBook)}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ) : null
          }
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      </ScrollViewMarker>

      <Modal
        visible={!!groupNameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setGroupNameModal(null)}
      >
        <Pressable style={s.groupModalOverlay} onPress={() => setGroupNameModal(null)}>
          <Pressable style={s.groupModalCard} onPress={() => {}}>
            <Text style={s.groupModalTitle}>
              {groupNameModal?.mode === "rename"
                ? t("common.rename", "重命名")
                : t("library.createGroup", "新建分组")}
            </Text>
            <TextInput
              style={s.groupModalInput}
              value={groupNameInput}
              onChangeText={setGroupNameInput}
              placeholder={t("library.groupNamePrompt", "分组名称")}
              placeholderTextColor={colors.mutedForeground}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void submitGroupName()}
            />
            <View style={s.groupModalActions}>
              <NativeButton
                label={t("common.cancel", "Отмена")}
                onPress={() => setGroupNameModal(null)}
                variant="secondary"
              />
              <NativeButton
                label={t("common.confirm", "Готово")}
                onPress={() => void submitGroupName()}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <TagManagementSheet
        visible={tagSheetOpen}
        book={tagSheetBook}
        allTags={allTags}
        batchBookIds={batchTagBookIds.length > 0 ? batchTagBookIds : undefined}
        onClose={() => {
          setTagSheetOpen(false);
          setBatchTagBookIds([]);
        }}
        onAddTag={addTag}
        onAddTagToBook={addTagToBook}
        onRemoveTagFromBook={removeTagFromBook}
        onRemoveTag={removeTag}
        onRenameTag={renameTag}
      />
      <GroupPickerSheet
        visible={showGroupPicker}
        groups={groups}
        onSelect={handleGroupPickerSelect}
        onCreateGroup={handleGroupPickerCreate}
        onClose={() => setShowGroupPicker(false)}
      />
      <ExtractorWebView ref={extractorRef} />
    </>
  );
}

const makeStyles = (
  colors: ThemeColors,
  layout: {
    horizontalPadding: number;
    contentWidth: number;
    gridGap: number;
    gridItemWidth: number;
    isWideScreen: boolean;
  },
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: 12,
      paddingBottom: 8,
      alignItems: "center",
    },
    headerInner: { width: "100%", maxWidth: layout.contentWidth },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
    nativeHeaderActions: { flexDirection: "row", alignItems: "center" },
    nativeHeaderButton: {
      width: 40,
      height: 40,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    headerBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    filterSection: {
      paddingBottom: 8,
      alignItems: "center",
    },
    tagSection: {
      marginBottom: 4,
    },
    tagScroll: { marginBottom: 4 },
    tagScrollWide: { flex: 1, minWidth: 0, marginBottom: 0 },
    tagScrollContent: { gap: 6, paddingRight: 8 },
    tagChip: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: radius.full,
      backgroundColor: colors.muted,
    },
    tagChipActive: { backgroundColor: colors.primary },
    tagChipText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    tagChipTextActive: { color: colors.primaryForeground },
    primaryScroll: { flex: 1, overflow: "visible" },
    emptyScrollContent: {
      flexGrow: 1,
      width: "100%",
      maxWidth: layout.contentWidth + layout.horizontalPadding * 2,
      alignSelf: "center",
      paddingHorizontal: layout.horizontalPadding,
    },
    vecBanner: {
      backgroundColor: `${colors.muted}0D`,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
    },
    vecBannerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    vecBannerInfo: { flex: 1, minWidth: 0 },
    vecBannerStatusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    vecBannerStatus: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },
    vecBannerTitle: {
      fontFamily: secondLevelTitleFontFamily,
      fontSize: 12,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    vecProgressBg: {
      height: 4,
      backgroundColor: `${colors.muted}1A`,
      borderRadius: radius.full,
      marginTop: 8,
      overflow: "hidden",
    },
    vecProgressFill: { height: 4, backgroundColor: colors.primary, borderRadius: radius.full },
    emptyIconWrap: {
      width: 80,
      height: 80,
      borderRadius: radius.full,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    emptyImportBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.full,
      paddingHorizontal: 24,
      paddingVertical: 10,
    },
    emptyImportText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
    noResultsWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 80 },
    noResultsText: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 12 },
    gridRow: { gap: layout.gridGap, justifyContent: "flex-start" },
    gridContent: {
      width: "100%",
      maxWidth: layout.contentWidth + layout.horizontalPadding * 2,
      alignSelf: "center",
      paddingHorizontal: layout.horizontalPadding,
      paddingTop: 24,
      paddingBottom: 24,
    },
    gridItem: {
      width: layout.gridItemWidth,
      marginBottom: layout.gridGap,
      overflow: "visible",
    },
    librarySectionTabs: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      marginBottom: 20,
    },
    librarySectionTabPressed: { opacity: 0.7 },
    librarySectionTabText: {
      color: colors.mutedForeground,
      fontFamily: secondLevelTitleFontFamily,
      fontSize: fontSize.lg,
      lineHeight: 24,
      fontWeight: fontWeight.normal,
    },
    librarySectionTabTextActive: { color: colors.foreground },
    catalogSection: { overflow: "visible" },
    catalogGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: layout.gridGap,
      overflow: "visible",
    },
    groupModalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.24)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
    },
    groupModalCard: {
      width: "100%",
      maxWidth: 360,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 16,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.2,
      shadowRadius: 18,
      elevation: 12,
    },
    groupModalTitle: {
      fontFamily: secondLevelTitleFontFamily,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      marginBottom: 12,
    },
    groupModalInput: {
      height: 42,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.foreground,
      paddingHorizontal: 12,
      fontSize: fontSize.sm,
      backgroundColor: colors.background,
    },
    groupModalActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 8,
      marginTop: 14,
    },
    groupModalSecondary: {
      height: 36,
      paddingHorizontal: 14,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.muted,
    },
    groupModalSecondaryText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    groupModalPrimary: {
      height: 36,
      paddingHorizontal: 16,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
    },
    groupModalPrimaryText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
  });
