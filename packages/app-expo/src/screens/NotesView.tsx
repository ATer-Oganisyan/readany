import {
  type NativeNoteListItem,
  type NativeNoteListSection,
  NativeNotesList,
} from "@/components/notes/NativeNotesList";
import {
  BookOpenIcon,
  ChevronLeftIcon,
  HighlighterIcon,
  NotebookPenIcon,
} from "@/components/ui/Icon";
import { NativeContextMenuButton } from "@/components/ui/NativeContextMenuButton";
import { Text } from "@/components/ui/Typography";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useAnnotationStore, useLibraryStore } from "@/stores";
import { useColors } from "@/styles/theme";
import { useHeaderHeight } from "@react-navigation/elements";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HighlightWithBook } from "@readany/core/db/database";
import { AnnotationExporter, type ExportFormat } from "@readany/core/export";
import { sortAnnotationsByPosition } from "@readany/core/reader";
import type { Highlight } from "@readany/core/types";
import { eventBus } from "@readany/core/utils/event-bus";
/** Notes list plus the existing per-book annotation detail view. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Image, ScrollView, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { HighlightCard } from "./notes/HighlightCard";
import { NoteCard } from "./notes/NoteCard";
import { makeStyles } from "./notes/notes-styles";
import { useResolvedCovers } from "./notes/useResolvedCovers";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailTab = "notes" | "highlights";

const DAY_MS = 24 * 60 * 60 * 1_000;

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result.getTime();
}

function cleanNoteText(value: string) {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function noteListItem(highlight: HighlightWithBook): NativeNoteListItem {
  const rawLines = (highlight.note || "")
    .split(/\r?\n/)
    .map((line) => cleanNoteText(line))
    .filter(Boolean);
  const title = rawLines[0] || "Заметка";
  const noteBody = cleanNoteText(rawLines.slice(1).join(" "));
  const quote = cleanNoteText(highlight.text || "");
  const timestamp = highlight.updatedAt || highlight.createdAt;
  const date = new Date(timestamp);
  const today = startOfDay(new Date());
  const dateStart = startOfDay(date);
  const dateLabel =
    dateStart === today
      ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date)
      : dateStart === today - DAY_MS
        ? "Вчера"
        : new Intl.DateTimeFormat("ru-RU", {
            day: "numeric",
            month: "short",
            ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
          }).format(date);

  return {
    id: highlight.id,
    title,
    preview: noteBody || quote,
    dateLabel,
    bookTitle: highlight.bookTitle || "Книга",
  };
}

export function NotesView({
  initialBookId,
  showBackButton,
  edges = ["top"],
  hideDetailHeader,
}: {
  initialBookId?: string | null;
  showBackButton?: boolean;
  edges?: ("top" | "bottom" | "left" | "right")[];
  hideDetailHeader?: boolean;
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  const nativeHeaderHeight = useHeaderHeight();
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { highlightsWithBooks, loadAllHighlightsWithBooks, removeHighlight, updateHighlight } =
    useAnnotationStore();
  const books = useLibraryStore((s) => s.books);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(initialBookId || null);
  const [isLoading, setIsLoading] = useState(true);
  const [detailTab, setDetailTab] = useState<DetailTab>("notes");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      loadAllHighlightsWithBooks(500).finally(() => setIsLoading(false));

      return () => {
        setSelectedBookId(null);
        setEditingId(null);
      };
    }, [loadAllHighlightsWithBooks]),
  );

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      setIsLoading(true);
      loadAllHighlightsWithBooks(500).finally(() => setIsLoading(false));
    });
  }, [loadAllHighlightsWithBooks]);

  // Handle incoming bookId
  useEffect(() => {
    if (initialBookId) {
      setSelectedBookId(initialBookId);
      setEditingId(null);
      setDetailTab("notes");
    }
  }, [initialBookId]);

  // Group by book — matching Tauri exactly
  const bookNotebooks = useMemo(() => {
    const grouped = new Map<
      string,
      {
        bookId: string;
        title: string;
        author: string;
        coverUrl: string | null;
        highlights: HighlightWithBook[];
        notesCount: number;
        highlightsOnlyCount: number;
        latestAt: number;
      }
    >();

    for (const h of highlightsWithBooks) {
      const existing = grouped.get(h.bookId);
      if (existing) {
        existing.highlights.push(h);
        if (h.note) existing.notesCount++;
        else existing.highlightsOnlyCount++;
        if (h.createdAt > existing.latestAt) existing.latestAt = h.createdAt;
      } else {
        grouped.set(h.bookId, {
          bookId: h.bookId,
          title: h.bookTitle || t("notes.unknownBook", "未知书籍"),
          author: h.bookAuthor || t("notes.unknownAuthor", "未知作者"),
          coverUrl: h.bookCoverUrl || null,
          highlights: [h],
          notesCount: h.note ? 1 : 0,
          highlightsOnlyCount: h.note ? 0 : 1,
          latestAt: h.createdAt,
        });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.latestAt - a.latestAt);
  }, [highlightsWithBooks, t]);

  // Resolve cover URLs using shared hook
  const resolvedCovers = useResolvedCovers(bookNotebooks);

  const selectedBook = useMemo(() => {
    if (!selectedBookId) return null;
    return bookNotebooks.find((b) => b.bookId === selectedBookId) || null;
  }, [selectedBookId, bookNotebooks]);

  const { notesList, highlightsList } = useMemo(() => {
    if (!selectedBook) return { notesList: [], highlightsList: [] };
    const sorted = sortAnnotationsByPosition(selectedBook.highlights);
    return {
      notesList: sorted.filter((h) => h.note),
      highlightsList: sorted.filter((h) => !h.note),
    };
  }, [selectedBook]);

  const currentList = detailTab === "notes" ? notesList : highlightsList;

  const allNotes = useMemo(
    () =>
      highlightsWithBooks
        .filter((highlight) => Boolean(highlight.note?.trim()))
        .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)),
    [highlightsWithBooks],
  );

  const noteSections = useMemo<NativeNoteListSection[]>(() => {
    const today = startOfDay(new Date());
    const buckets: Array<{ title: string; from: number; to: number }> = [
      { title: "Сегодня", from: today, to: Number.POSITIVE_INFINITY },
      { title: "Вчера", from: today - DAY_MS, to: today },
      { title: "За последние 7 дней", from: today - 7 * DAY_MS, to: today - DAY_MS },
      { title: "За последние 30 дней", from: today - 30 * DAY_MS, to: today - 7 * DAY_MS },
      { title: "Раньше", from: Number.NEGATIVE_INFINITY, to: today - 30 * DAY_MS },
    ];

    return buckets
      .map((bucket) => ({
        title: bucket.title,
        data: allNotes
          .filter((highlight) => {
            const timestamp = highlight.updatedAt || highlight.createdAt;
            return timestamp >= bucket.from && timestamp < bucket.to;
          })
          .map(noteListItem),
      }))
      .filter((section) => section.data.length > 0);
  }, [allNotes]);

  // Group by chapter
  const itemsByChapter = useMemo(() => {
    const chapters: { chapter: string; items: HighlightWithBook[] }[] = [];
    const chapterMap = new Map<string, HighlightWithBook[]>();
    for (const h of currentList) {
      const chapter = h.chapterTitle || t("notes.unknownChapter", "未知章节");
      const arr = chapterMap.get(chapter) || [];
      arr.push(h);
      chapterMap.set(chapter, arr);
    }
    for (const [chapter, items] of chapterMap) {
      chapters.push({ chapter, items });
    }
    return chapters;
  }, [currentList, t]);

  const handleOpenBook = useCallback(
    (bookId: string, cfi?: string) => {
      void openMobileBook({ bookId, navigation: nav, t, cfi });
    },
    [nav, t],
  );

  const handleDeleteNote = useCallback(
    (highlight: HighlightWithBook) => {
      Alert.alert(t("common.confirm", "确认"), t("notes.deleteNoteConfirm", "确定删除此笔记？"), [
        { text: t("common.cancel", "取消"), style: "cancel" },
        {
          text: t("common.delete", "删除"),
          style: "destructive",
          onPress: () => {
            updateHighlight(highlight.id, { note: undefined });
          },
        },
      ]);
    },
    [updateHighlight, t],
  );

  const handleDeleteHighlight = useCallback(
    (highlight: HighlightWithBook) => {
      Alert.alert(
        t("common.confirm", "确认"),
        t("notes.deleteHighlightConfirm", "确定删除此高亮？"),
        [
          { text: t("common.cancel", "取消"), style: "cancel" },
          {
            text: t("common.delete", "删除"),
            style: "destructive",
            onPress: () => {
              removeHighlight(highlight.id);
            },
          },
        ],
      );
    },
    [removeHighlight, t],
  );

  const startEditNote = useCallback((highlight: HighlightWithBook) => {
    setEditingId(highlight.id);
    setEditNote(highlight.note || "");
  }, []);

  const saveNote = useCallback(
    (id: string) => {
      updateHighlight(id, { note: editNote || undefined });
      setEditingId(null);
      setEditNote("");
    },
    [updateHighlight, editNote],
  );

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditNote("");
  }, []);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!selectedBook) return;

      const book = books.find((b) => b.id === selectedBook.bookId);
      if (!book) return;

      const exporter = new AnnotationExporter();
      const content = exporter.export(selectedBook.highlights as Highlight[], [], book, { format });

      try {
        if (format === "notion") {
          await exporter.copyToClipboard(content);
          Alert.alert(t("common.success", "成功"), t("notes.copiedToClipboard", "已复制到剪贴板"));
        } else {
          const ext = format === "json" ? "json" : "md";
          await exporter.downloadAsFile(content, `${selectedBook.title}-${format}.${ext}`, format);
        }
      } catch (err) {
        console.error("Export failed:", err);
        Alert.alert(t("common.error", "错误"), t("notes.exportFailed", "导出失败"));
      }
    },
    [selectedBook, books, t],
  );

  // Loading
  if (isLoading) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={edges}>
        <View style={[s.loadingWrap, { transform: [{ translateY: -nativeHeaderHeight / 2 }] }]}>
          <View style={s.spinner} />
          <Text style={s.loadingText}>{t("common.loading", "加载中...")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Empty
  if (!selectedBookId && allNotes.length === 0) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={edges}>
        <View style={[s.emptyWrap, { transform: [{ translateY: -nativeHeaderHeight / 2 }] }]}>
          <Text style={s.emptyTitle}>{t("notes.empty", "暂无笔记")}</Text>
          <Text style={s.emptyHint}>{t("notes.emptyHint", "阅读时长按文字添加高亮和笔记")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Detail view
  if (selectedBookId && selectedBook) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={edges}>
        {/* Detail header - hide entirely when from reader and empty */}
        {!(hideDetailHeader && selectedBook.highlights.length === 0) && (
          <View style={s.detailHeader}>
            {!hideDetailHeader && (
              <View style={s.detailHeaderTop}>
                {/* Back button - return to list when in tab navigation */}
                {showBackButton && (
                  <TouchableOpacity style={s.backBtn} onPress={() => setSelectedBookId(null)}>
                    <ChevronLeftIcon size={20} color={colors.foreground} />
                  </TouchableOpacity>
                )}

                {/* Book cover */}
                {resolvedCovers.get(selectedBook.bookId) || selectedBook.coverUrl ? (
                  <Image
                    source={{
                      uri: resolvedCovers.get(selectedBook.bookId) || selectedBook.coverUrl || "",
                    }}
                    style={s.detailCover}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={s.detailCoverFallback}>
                    <BookOpenIcon size={16} color={colors.mutedForeground} />
                  </View>
                )}

                <View style={s.detailHeaderInfo}>
                  <Text style={s.detailTitle} numberOfLines={1}>
                    {selectedBook.title}
                  </Text>
                  <Text style={s.detailAuthor}>{selectedBook.author}</Text>
                </View>

                {/* Export button */}
                <View style={s.exportBtn}>
                  <NativeContextMenuButton
                    accessibilityLabel="Экспорт заметок"
                    sfSymbol="square.and.arrow.up"
                    size={40}
                    color={colors.foreground}
                    items={[
                      {
                        key: "markdown",
                        label: "Markdown",
                        sfSymbol: "doc.text",
                        onPress: () => void handleExport("markdown"),
                      },
                      {
                        key: "json",
                        label: "JSON",
                        sfSymbol: "arrow.down.doc",
                        onPress: () => void handleExport("json"),
                      },
                      {
                        key: "obsidian",
                        label: "Obsidian",
                        sfSymbol: "diamond",
                        onPress: () => void handleExport("obsidian"),
                      },
                      {
                        key: "notion",
                        label: "Notion",
                        sfSymbol: "doc.on.clipboard",
                        onPress: () => void handleExport("notion"),
                      },
                    ]}
                  />
                </View>
              </View>
            )}

            {/* Tabs */}
            <View style={s.detailTabRow}>
              <View style={s.tabSwitcher}>
                <TouchableOpacity
                  style={[s.tabBtn, detailTab === "notes" && s.tabBtnActive]}
                  onPress={() => setDetailTab("notes")}
                >
                  <NotebookPenIcon
                    size={12}
                    color={
                      detailTab === "notes" ? colors.primaryForeground : colors.mutedForeground
                    }
                  />
                  <Text style={[s.tabBtnText, detailTab === "notes" && s.tabBtnTextActive]}>
                    {t("notebook.notesSection", "笔记")} ({selectedBook.notesCount || 0})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.tabBtn, detailTab === "highlights" && s.tabBtnActive]}
                  onPress={() => setDetailTab("highlights")}
                >
                  <HighlighterIcon
                    size={12}
                    color={
                      detailTab === "highlights" ? colors.primaryForeground : colors.mutedForeground
                    }
                  />
                  <Text style={[s.tabBtnText, detailTab === "highlights" && s.tabBtnTextActive]}>
                    {t("notebook.highlightsSection", "高亮")} (
                    {selectedBook.highlightsOnlyCount || 0})
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Detail content */}
        {currentList.length === 0 ? (
          <View style={[s.detailEmpty, { transform: [{ translateY: -nativeHeaderHeight / 2 }] }]}>
            <Text style={s.detailEmptyText}>
              {detailTab === "notes"
                ? t("notes.noNotes", "Заметок пока нет")
                : t("highlights.noHighlights", "Выделений пока нет")}
            </Text>
          </View>
        ) : (
          <ScrollView style={s.detailList} showsVerticalScrollIndicator={false}>
            {itemsByChapter.map(({ chapter, items }) => (
              <View key={chapter} style={s.chapterGroup}>
                {/* Chapter divider */}
                <View style={s.chapterDivider}>
                  <View style={s.chapterLine} />
                  <Text style={s.chapterName}>{chapter}</Text>
                  <View style={s.chapterLine} />
                </View>

                {items.map((item) =>
                  detailTab === "notes" ? (
                    <NoteCard
                      key={item.id}
                      highlight={item}
                      isEditing={editingId === item.id}
                      editNote={editNote}
                      setEditNote={setEditNote}
                      onStartEdit={() => startEditNote(item)}
                      onSaveNote={() => saveNote(item.id)}
                      onCancelEdit={cancelEdit}
                      onDeleteNote={() => handleDeleteNote(item)}
                      onNavigate={() => handleOpenBook(selectedBook.bookId, item.cfi)}
                      t={t}
                    />
                  ) : (
                    <HighlightCard
                      key={item.id}
                      highlight={item}
                      onDelete={() => handleDeleteHighlight(item)}
                      onNavigate={() => handleOpenBook(selectedBook.bookId, item.cfi)}
                    />
                  ),
                )}
              </View>
            ))}
            <View style={{ height: 24 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  // Main list view
  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={edges}>
      {noteSections.length > 0 ? (
        <NativeNotesList
          sections={noteSections}
          onPress={(id) => {
            const note = allNotes.find((item) => item.id === id);
            if (!note) return;
            setSelectedBookId(note.bookId);
            setEditingId(null);
            setDetailTab("notes");
          }}
        />
      ) : (
        <View style={[s.emptyWrap, { transform: [{ translateY: -nativeHeaderHeight / 2 }] }]}>
          <Text style={s.emptyTitle}>Заметок пока нет</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

/** Note detail card — matching Tauri NoteDetailCard */
