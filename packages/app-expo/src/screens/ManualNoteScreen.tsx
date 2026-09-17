import { NativeNoteEditor } from "@/components/notes/NativeNoteEditor";
import { ChevronDownIcon } from "@/components/ui/Icon";
import { NativeButton } from "@/components/ui/NativeButton";
import { NativeContextMenuButton } from "@/components/ui/NativeContextMenuButton";
import { Text } from "@/components/ui/Typography";
import { toast } from "@/lib/notifications";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useAnnotationStore, useLibraryStore } from "@/stores";
import { headingFontFamily, spacing, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { generateId } from "@readany/core/utils";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<RootStackParamList, "ManualNote">;

export function ManualNoteScreen({ navigation, route }: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const books = useLibraryStore((state) => state.books);
  const addHighlight = useAnnotationStore((state) => state.addHighlight);
  const updateHighlight = useAnnotationStore((state) => state.updateHighlight);
  const removeHighlight = useAnnotationStore((state) => state.removeHighlight);
  const highlightsWithBooks = useAnnotationStore((state) => state.highlightsWithBooks);
  const highlights = useAnnotationStore((state) => state.highlights);
  const noteId = route.params?.noteId;
  const lockedBookId = route.params?.bookId;
  const existingNote = useMemo(
    () =>
      highlightsWithBooks.find((highlight) => highlight.id === noteId) ??
      highlights.find((highlight) => highlight.id === noteId),
    [highlightsWithBooks, highlights, noteId],
  );
  const existingNoteHasBook = Boolean(
    existingNote &&
      (existingNote.cfi || existingNote.text || existingNote.chapterTitle === "Заметка к книге"),
  );
  const [bookId, setBookId] = useState(
    existingNoteHasBook ? existingNote?.bookId || "" : route.params?.bookId || "",
  );
  const initialContent = existingNote?.note ?? route.params?.text ?? "";
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const effectiveBookId = lockedBookId || bookId;
  const selectedBook = useMemo(
    () => books.find((book) => book.id === effectiveBookId),
    [effectiveBookId, books],
  );

  const save = useCallback(async () => {
    const note = content.trim();
    if (!note || saving) return;

    setSaving(true);
    const now = Date.now();
    try {
      if (existingNote) {
        updateHighlight(existingNote.id, {
          bookId: effectiveBookId,
          note,
          chapterTitle: existingNote.cfi
            ? existingNote.chapterTitle
            : effectiveBookId
              ? "Заметка к книге"
              : undefined,
          updatedAt: now,
        });
        navigation.goBack();
        return;
      }

      await addHighlight({
        id: generateId(),
        bookId: effectiveBookId,
        cfi: route.params?.cfi ?? "",
        text: route.params?.text ?? "",
        color: "yellow",
        note,
        chapterTitle:
          route.params?.chapterTitle ?? (effectiveBookId ? "Заметка к книге" : undefined),
        createdAt: now,
        updatedAt: now,
      });
      navigation.goBack();
    } catch (error) {
      console.error("[ManualNoteScreen] Failed to save note:", error);
      toast.error(t("notes.saveFailed", "Не получилось сохранить заметку"), {
        description: t("common.tryAgain", "Попробуйте ещё раз"),
      });
    } finally {
      setSaving(false);
    }
  }, [
    addHighlight,
    content,
    existingNote,
    navigation,
    route.params?.cfi,
    route.params?.chapterTitle,
    route.params?.text,
    saving,
    effectiveBookId,
    t,
    updateHighlight,
  ]);

  const deleteNote = useCallback(() => {
    if (!existingNote || saving) return;
    // Заметка и её выделение — одна запись: удаление заметки снимает подсветку в тексте.
    removeHighlight(existingNote.id);
    navigation.goBack();
  }, [existingNote, saving, removeHighlight, navigation]);

  useLayoutEffect(() => {
    const canSave = Boolean(content.trim()) && !saving;

    navigation.setOptions({
      title: existingNote
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
                label: existingNote ? t("common.delete", "Удалить") : t("common.close", "Закрыть"),
                accessibilityLabel: existingNote
                  ? t("common.delete", "Удалить")
                  : t("common.close", "Закрыть"),
                icon: existingNote
                  ? { type: "sfSymbol" as const, name: "trash" }
                  : { type: "sfSymbol" as const, name: "xmark" },
                disabled: saving,
                onPress: existingNote ? deleteNote : () => navigation.goBack(),
              },
            ],
            unstable_headerRightItems: () => [
              ...(!lockedBookId
                ? [
                    {
                      type: "menu" as const,
                      label: t("common.book", "Книга"),
                      accessibilityLabel: t("notes.chooseBook", "Выбрать книгу"),
                      icon: { type: "sfSymbol" as const, name: "book.closed" as const },
                      menu: {
                        title: t("common.book", "Книга"),
                        multiselectable: false,
                        items: [
                          {
                            type: "action" as const,
                            label: t("common.noBook", "Без книги"),
                            state: bookId ? ("off" as const) : ("on" as const),
                            onPress: () => setBookId(""),
                          },
                          ...books.map((book) => ({
                            type: "action" as const,
                            label: book.meta.title,
                            state: book.id === bookId ? ("on" as const) : ("off" as const),
                            onPress: () => setBookId(book.id),
                          })),
                        ],
                      },
                    },
                  ]
                : []),
              {
                type: "button" as const,
                label: saving ? t("notes.saving", "Сохраняем") : t("common.done", "Готово"),
                accessibilityLabel: t("notes.saveNote", "Сохранить заметку"),
                icon: { type: "sfSymbol" as const, name: "checkmark" },
                disabled: !canSave,
                variant: "prominent" as const,
                tintColor: colors.primary,
                onPress: () => void save(),
              },
            ],
          }
        : {
            headerTitle: lockedBookId
              ? undefined
              : () => (
                  <NativeContextMenuButton
                    accessibilityLabel={t("notes.chooseBook", "Выберите книгу")}
                    items={[
                      {
                        key: "no-book",
                        label: t("common.noBook", "Без книги"),
                        icon: bookId ? null : "check",
                        iconPosition: "trailing",
                        onPress: () => setBookId(""),
                      },
                      ...books.map((book) => ({
                        key: book.id,
                        label: book.meta.title,
                        icon: book.id === bookId ? ("check" as const) : null,
                        iconPosition: "trailing" as const,
                        onPress: () => setBookId(book.id),
                      })),
                    ]}
                    renderTrigger={(openMenu) => (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={t("notes.chooseBook", "Выберите книгу")}
                        style={styles.headerBookButton}
                        onPress={openMenu}
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
                    )}
                  />
                ),
            headerRight: () => (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {existingNote ? (
                  <NativeButton
                    label={t("common.delete", "Удалить")}
                    accessibilityLabel={t("common.delete", "Удалить")}
                    icon="delete"
                    iconOnly
                    size="small"
                    variant="tertiary"
                    disabled={saving}
                    onPress={deleteNote}
                  />
                ) : null}
                <NativeButton
                  label={t("common.done", "Готово")}
                  accessibilityLabel={t("notes.saveNote", "Сохранить заметку")}
                  icon="check"
                  iconOnly
                  size="small"
                  variant="tertiary"
                  disabled={!canSave}
                  onPress={() => void save()}
                />
              </View>
            ),
          }),
    });
  }, [
    bookId,
    books,
    colors.background,
    colors.foreground,
    colors.mutedForeground,
    colors.primary,
    content,
    deleteNote,
    existingNote,
    navigation,
    lockedBookId,
    save,
    saving,
    selectedBook?.meta.title,
    t,
  ]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["bottom"]}
    >
      <View style={styles.content}>
        <NativeNoteEditor initialValue={initialContent} onChange={setContent} autoFocus />
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
