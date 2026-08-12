import { NativeNoteEditor } from "@/components/notes/NativeNoteEditor";
import { ChevronDownIcon } from "@/components/ui/Icon";
import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useAnnotationStore, useLibraryStore } from "@/stores";
import { headingFontFamily, spacing, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { generateId } from "@readany/core/utils";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
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
  const [bookId, setBookId] = useState(
    existingNoteHasBook ? existingNote?.bookId || "" : route.params?.bookId || "",
  );
  const [content, setContent] = useState(existingNote?.note || "");
  const [saving, setSaving] = useState(false);
  const selectedBook = useMemo(() => books.find((book) => book.id === bookId), [bookId, books]);

  const chooseBook = useCallback(() => {
    Alert.alert(t("notes.chooseBook", "Выберите книгу"), undefined, [
      { text: t("common.noBook", "Без книги"), onPress: () => setBookId("") },
      ...books.slice(0, 6).map((book) => ({
        text: book.meta.title,
        onPress: () => setBookId(book.id),
      })),
      { text: t("common.cancel", "Отмена"), style: "cancel" as const },
    ]);
  }, [books, t]);

  const save = useCallback(async () => {
    const note = content.trim();
    if (!note || saving) return;

    setSaving(true);
    const now = Date.now();
    try {
      if (existingNote) {
        updateHighlight(existingNote.id, {
          bookId: selectedBook?.id ?? "",
          note,
          chapterTitle: selectedBook ? "Заметка к книге" : undefined,
          updatedAt: now,
        });
        navigation.goBack();
        return;
      }

      await addHighlight({
        id: generateId(),
        bookId: selectedBook?.id ?? "",
        cfi: route.params?.cfi ?? "",
        text: route.params?.text ?? "",
        color: "yellow",
        note,
        chapterTitle: route.params?.chapterTitle ?? (selectedBook ? "Заметка к книге" : undefined),
        createdAt: now,
        updatedAt: now,
      });
      navigation.goBack();
    } catch (error) {
      console.error("[ManualNoteScreen] Failed to save note:", error);
      Alert.alert(
        t("notes.saveFailed", "Не получилось сохранить заметку"),
        t("common.tryAgain", "Попробуйте ещё раз"),
      );
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
    selectedBook,
    t,
    updateHighlight,
  ]);

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
            unstable_headerRightItems: () => [
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
              {
                type: "button" as const,
                label: saving ? t("notes.saving", "Сохраняем") : t("common.done", "Готово"),
                accessibilityLabel: t("notes.saveNote", "Сохранить заметку"),
                icon: { type: "sfSymbol" as const, name: "checkmark" as const },
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
        <NativeNoteEditor initialValue={existingNote?.note} onChange={setContent} autoFocus />
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
