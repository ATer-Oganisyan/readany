import { NativeNoteEditor } from "@/components/notes/NativeNoteEditor";
import { ChevronDownIcon } from "@/components/ui/Icon";
import { getStrokeIconImageSource } from "@/components/ui/MishanaerIcon";
import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { toast } from "@/lib/notifications";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useAnnotationStore, useLibraryStore } from "@/stores";
import { headingFontFamily, spacing, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { generateId } from "@readany/core/utils";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<RootStackParamList, "ManualNote">;

export function ManualNoteScreen({ navigation, route }: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const books = useLibraryStore((state) => state.books);
  const addHighlight = useAnnotationStore((state) => state.addHighlight);
  const updateHighlight = useAnnotationStore((state) => state.updateHighlight);
  const highlightsWithBooks = useAnnotationStore((state) => state.highlightsWithBooks);
  const noteId = route.params?.noteId;
  const existingNote = useMemo(
    () => highlightsWithBooks.find((highlight) => highlight.id === noteId),
    [highlightsWithBooks, noteId],
  );
  const existingNoteHasBook = Boolean(
    existingNote &&
      (existingNote.cfi || existingNote.text || existingNote.chapterTitle === "Заметка к книге"),
  );
  const initialBookId = existingNoteHasBook
    ? existingNote?.bookId || ""
    : route.params?.bookId || "";
  const [bookId, setBookId] = useState(initialBookId);
  const [content, setContent] = useState(existingNote?.note || "");
  const [saving, setSaving] = useState(false);
  const savePendingRef = useRef(false);
  const [savedDraft, setSavedDraft] = useState<{ id: string; bookId: string; note: string } | null>(
    null,
  );
  const savedDraftRef = useRef<typeof savedDraft>(null);
  const selectedBook = useMemo(() => books.find((book) => book.id === bookId), [bookId, books]);
  const initialDraftRef = useRef({ bookId: initialBookId, note: existingNote?.note?.trim() ?? "" });
  const currentDraftRef = useRef({ bookId: initialBookId, note: content });
  // Native callbacks can precede React's commit, including on the final save
  // frame. Update the snapshots in the handlers rather than waiting to render.
  const changeContent = useCallback((note: string) => {
    currentDraftRef.current.note = note;
    setContent(note);
  }, []);
  const selectBook = useCallback((id: string) => {
    currentDraftRef.current.bookId = id;
    setBookId(id);
  }, []);

  const requestCancel = useCallback(() => {
    if (savePendingRef.current) return;
    const current = currentDraftRef.current;
    const baseline = savedDraftRef.current ?? initialDraftRef.current;
    const hasUnsavedChanges =
      current.note.trim() !== baseline.note ||
      (Boolean(current.note.trim() || baseline.note) && current.bookId !== baseline.bookId);
    if (!hasUnsavedChanges) {
      navigation.goBack();
      return;
    }
    Alert.alert(
      t("notes.discardChangesTitle", "Не сохранять изменения?"),
      t("notes.discardChangesDescription", "Изменения в этой заметке будут потеряны."),
      [
        { text: t("notes.keepEditing", "Продолжить редактирование"), style: "cancel" },
        {
          text: t("notes.discardChanges", "Не сохранять"),
          style: "destructive",
          onPress: () => navigation.goBack(),
        },
      ],
    );
  }, [navigation, t]);

  const chooseBook = useCallback(() => {
    Alert.alert(t("notes.chooseBook", "Выберите книгу"), undefined, [
      { text: t("common.noBook", "Без книги"), onPress: () => selectBook("") },
      ...books.slice(0, 6).map((book) => ({
        text: book.meta.title,
        onPress: () => selectBook(book.id),
      })),
      { text: t("common.cancel", "Отмена"), style: "cancel" as const },
    ]);
  }, [books, selectBook, t]);

  const save = useCallback(async () => {
    const note = currentDraftRef.current.note.trim();
    if (!note || savePendingRef.current) return;

    savePendingRef.current = true;
    setSaving(true);
    const now = Date.now();
    const bookToSave = books.find((book) => book.id === currentDraftRef.current.bookId);
    const savedBookId = bookToSave?.id ?? "";
    const existingId = savedDraftRef.current?.id ?? existingNote?.id;
    const savedId = existingId ?? generateId();
    try {
      if (existingId) {
        await updateHighlight(existingId, {
          bookId: savedBookId,
          note,
          chapterTitle: bookToSave ? "Заметка к книге" : undefined,
          updatedAt: now,
        });
      } else {
        await addHighlight({
          id: savedId,
          bookId: savedBookId,
          cfi: route.params?.cfi ?? "",
          text: route.params?.text ?? "",
          color: "yellow",
          note,
          chapterTitle: route.params?.chapterTitle ?? (bookToSave ? "Заметка к книге" : undefined),
          createdAt: now,
          updatedAt: now,
        });
      }
      // Native input can deliver more changes while SQLite is writing. Keep
      // that newer draft open and remember the committed id so its next Save
      // updates the same note instead of inserting a duplicate.
      savedDraftRef.current = { id: savedId, bookId: savedBookId, note };
      setSavedDraft(savedDraftRef.current);
      if (
        currentDraftRef.current.note.trim() === note &&
        currentDraftRef.current.bookId === savedBookId
      ) {
        navigation.goBack();
      }
    } catch (error) {
      console.error("[ManualNoteScreen] Failed to save note:", error);
      toast.error(t("notes.saveFailed", "Не получилось сохранить заметку"), {
        description: t("common.tryAgain", "Попробуйте ещё раз"),
      });
    } finally {
      savePendingRef.current = false;
      setSaving(false);
    }
  }, [
    addHighlight,
    books,
    existingNote,
    navigation,
    route.params?.cfi,
    route.params?.chapterTitle,
    route.params?.text,
    t,
    updateHighlight,
  ]);

  useLayoutEffect(() => {
    const canSave = Boolean(content.trim()) && !saving;

    navigation.setOptions({
      title:
        existingNote || savedDraft
          ? t("notes.editNote", "Редактировать заметку")
          : t("notes.newNote", "Новая заметка"),
      headerTransparent: Platform.OS === "ios",
      headerStyle: {
        backgroundColor: Platform.OS === "ios" ? "transparent" : colors.background,
      },
      ...(Platform.OS === "ios"
        ? {
            unstable_headerLeftItems: () => [
              {
                type: "button" as const,
                label: t("common.cancel", "Отмена"),
                accessibilityLabel: t("common.cancel", "Отмена"),
                disabled: saving,
                onPress: requestCancel,
              },
            ],
            unstable_headerRightItems: () => [
              {
                type: "menu" as const,
                label: t("common.book", "Книга"),
                accessibilityLabel: t("notes.chooseBook", "Выбрать книгу"),
                icon: {
                  type: "image" as const,
                  source: getStrokeIconImageSource("book"),
                },
                menu: {
                  title: t("common.book", "Книга"),
                  multiselectable: false,
                  items: [
                    {
                      type: "action" as const,
                      label: t("common.noBook", "Без книги"),
                      state: bookId ? ("off" as const) : ("on" as const),
                      onPress: () => selectBook(""),
                    },
                    ...books.map((book) => ({
                      type: "action" as const,
                      label: book.meta.title,
                      state: book.id === bookId ? ("on" as const) : ("off" as const),
                      onPress: () => selectBook(book.id),
                    })),
                  ],
                },
              },
              {
                type: "button" as const,
                label: saving ? t("notes.saving", "Сохраняем") : t("common.done", "Готово"),
                accessibilityLabel: t("notes.saveNote", "Сохранить заметку"),
                icon: {
                  type: "image" as const,
                  source: getStrokeIconImageSource("check"),
                },
                disabled: !canSave,
                variant: "prominent" as const,
                tintColor: colors.primary,
                onPress: () => void save(),
              },
            ],
          }
        : {
            headerTitle: () => (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t("notes.chooseBook", "Выберите книгу")}
                style={styles.headerBookButton}
                onPress={chooseBook}
                activeOpacity={0.65}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.headerBookTitle, { color: colors.foreground }]}
                >
                  {selectedBook?.meta.title ?? t("common.noBook", "Без книги")}
                </Text>
                <ChevronDownIcon size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            ),
            headerRight: () => (
              <NativeButton
                label={t("common.done", "Готово")}
                accessibilityLabel={t("notes.saveNote", "Сохранить заметку")}
                icon="check"
                size="small"
                variant="tertiary"
                disabled={!canSave}
                onPress={() => void save()}
              />
            ),
          }),
    });
  }, [
    bookId,
    books,
    chooseBook,
    colors.background,
    colors.foreground,
    colors.mutedForeground,
    colors.primary,
    content,
    existingNote,
    navigation,
    requestCancel,
    save,
    saving,
    savedDraft,
    selectBook,
    selectedBook?.meta.title,
    t,
  ]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["bottom"]}
    >
      <View style={styles.content}>
        <NativeNoteEditor initialValue={existingNote?.note} onChange={changeContent} autoFocus />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  headerBookButton: {
    maxWidth: 190,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerBookTitle: {
    flexShrink: 1,
    fontFamily: headingFontFamily,
    fontSize: 18,
    fontWeight: "600",
  },
});
