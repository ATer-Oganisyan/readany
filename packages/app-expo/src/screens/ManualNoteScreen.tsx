import { NativeButton } from "@/components/ui/NativeButton";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { Text } from "@/components/ui/Typography";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useAnnotationStore, useLibraryStore } from "@/stores";
import { radius, spacing, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { generateId } from "@readany/core/utils";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionSheetIOS, Alert, Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<RootStackParamList, "ManualNote">;

export function ManualNoteScreen({ navigation }: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const books = useLibraryStore((state) => state.books);
  const addHighlight = useAnnotationStore((state) => state.addHighlight);
  const [bookId, setBookId] = useState(books[0]?.id ?? "");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedBook = useMemo(() => books.find((book) => book.id === bookId), [bookId, books]);

  const chooseBook = () => {
    if (books.length < 2) return;

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t("notes.chooseBook", "К какой книге относится заметка?"),
          options: [...books.map((book) => book.meta.title), t("common.cancel", "Отмена")],
          cancelButtonIndex: books.length,
        },
        (index) => {
          const book = books[index];
          if (book) setBookId(book.id);
        },
      );
      return;
    }

    Alert.alert(t("notes.chooseBook", "К какой книге относится заметка?"), undefined, [
      ...books.slice(0, 6).map((book) => ({
        text: book.meta.title,
        onPress: () => setBookId(book.id),
      })),
      { text: t("common.cancel", "Отмена"), style: "cancel" as const },
    ]);
  };

  const save = async () => {
    const note = content.trim();
    if (!selectedBook || !note || saving) return;

    setSaving(true);
    const now = Date.now();
    try {
      await addHighlight({
        id: generateId(),
        bookId: selectedBook.id,
        cfi: "",
        text: "",
        color: "yellow",
        note,
        chapterTitle: t("notes.manualSection", "Без привязки к тексту"),
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
  };

  if (!selectedBook) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}
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
      style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}
      edges={["bottom"]}
    >
      <View style={styles.content}>
        <View style={styles.bookRow}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Книга</Text>
          <NativeButton
            label={selectedBook.meta.title}
            accessibilityLabel="Выбрать книгу"
            variant="tertiary"
            onPress={chooseBook}
            disabled={books.length < 2}
          />
        </View>
        <View style={styles.editor}>
          <RichTextEditor
            initialContent=""
            onChange={setContent}
            placeholder="Текст заметки"
            autoFocus
          />
        </View>
        <NativeButton
          label={saving ? "Сохраняем…" : "Сохранить"}
          accessibilityLabel="Сохранить заметку"
          fullWidth
          disabled={!content.trim() || saving}
          onPress={() => void save()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, padding: spacing.lg, gap: spacing.lg },
  bookRow: { gap: spacing.sm, alignItems: "flex-start" },
  label: { fontSize: 13, fontWeight: "600" },
  editor: { flex: 1, minHeight: 240, borderRadius: radius.lg, overflow: "hidden" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  emptyTitle: { fontSize: 22, fontWeight: "600" },
  emptyText: { fontSize: 16 },
});
