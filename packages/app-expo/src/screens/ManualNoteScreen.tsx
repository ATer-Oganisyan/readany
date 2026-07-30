import { NativeNoteEditor } from "@/components/notes/NativeNoteEditor";
import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useAnnotationStore, useLibraryStore } from "@/stores";
import { spacing, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { generateId } from "@readany/core/utils";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<RootStackParamList, "ManualNote">;

export function ManualNoteScreen({ navigation }: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const books = useLibraryStore((state) => state.books);
  const addHighlight = useAnnotationStore((state) => state.addHighlight);
  const [bookId, setBookId] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedBook = useMemo(() => books.find((book) => book.id === bookId), [bookId, books]);
  const storageBook = selectedBook ?? books[0];

  const chooseBook = useCallback(() => {
    Alert.alert(t("notes.chooseBook", "Выберите книгу"), undefined, [
      { text: "Без книги", onPress: () => setBookId("") },
      ...books.slice(0, 6).map((book) => ({
        text: book.meta.title,
        onPress: () => setBookId(book.id),
      })),
      { text: t("common.cancel", "Отмена"), style: "cancel" as const },
    ]);
  }, [books, t]);

  const save = useCallback(async () => {
    const note = content.trim();
    if (!storageBook || !note || saving) return;

    setSaving(true);
    const now = Date.now();
    try {
      await addHighlight({
        id: generateId(),
        bookId: storageBook.id,
        cfi: "",
        text: "",
        color: "yellow",
        note,
        chapterTitle: selectedBook ? "Заметка к книге" : undefined,
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
  }, [addHighlight, content, navigation, saving, selectedBook, storageBook, t]);

  useLayoutEffect(() => {
    const canSave = Boolean(content.trim()) && !saving && Boolean(storageBook);

    navigation.setOptions({
      title: "",
      headerTransparent: true,
      headerStyle: { backgroundColor: "transparent" },
      ...(Platform.OS === "ios"
        ? {
            unstable_headerRightItems: () => [
              {
                type: "menu" as const,
                label: "Книга",
                accessibilityLabel: "Выбрать книгу",
                icon: { type: "sfSymbol" as const, name: "book.closed" as const },
                menu: {
                  title: "Книга",
                  multiselectable: false,
                  items: [
                    {
                      type: "action" as const,
                      label: "Без книги",
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
                label: saving ? "Сохраняем" : "Готово",
                accessibilityLabel: "Сохранить заметку",
                icon: { type: "sfSymbol" as const, name: "checkmark" as const },
                disabled: !canSave,
                variant: "prominent" as const,
                tintColor: colors.primary,
                onPress: () => void save(),
              },
            ],
          }
        : {
            headerRight: () => (
              <NativeButton
                label="Готово"
                accessibilityLabel="Сохранить заметку"
                icon="check"
                size="small"
                variant="tertiary"
                disabled={!canSave}
                onPress={() => void save()}
              />
            ),
          }),
    });
  }, [bookId, books, colors.primary, content, navigation, save, saving, storageBook]);

  if (!storageBook) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={["bottom"]}
      >
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Книг пока нет</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Сначала добавьте книгу
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["bottom"]}
    >
      <View style={styles.content}>
        {Platform.OS !== "ios" ? (
          <NativeButton
            label={selectedBook?.meta.title ?? "Без книги"}
            accessibilityLabel="Выбрать книгу"
            variant="tertiary"
            onPress={chooseBook}
            style={styles.androidBookButton}
          />
        ) : null}
        <NativeNoteEditor onChange={setContent} autoFocus />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  androidBookButton: { marginHorizontal: spacing.md, marginTop: spacing.sm },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  emptyTitle: { fontSize: 22, fontWeight: "600" },
  emptyText: { fontSize: 16 },
});
