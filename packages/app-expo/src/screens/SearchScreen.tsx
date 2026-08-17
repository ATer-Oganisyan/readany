import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, spacing, useTheme } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Keyboard,
  type KeyboardEvent,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SearchScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const books = useLibraryStore((state) => state.books);
  const [query, setQuery] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const updateKeyboardHeight = (event: KeyboardEvent) => {
      setKeyboardHeight(event.endCoordinates.height);
    };
    const showEvent = process.env.EXPO_OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hideEvent = process.env.EXPO_OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, updateKeyboardHeight);
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerSearchBarOptions: {
        placeholder: t("search.booksPlaceholder", "Книги и авторы"),
        onChangeText: ({ nativeEvent }) => setQuery(nativeEvent.text),
      },
    });
  }, [navigation, t]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const results = useMemo(() => {
    if (!normalizedQuery) return [];
    return books.filter((book) => {
      if (book.deletedAt) return false;
      return [book.meta.title, book.meta.author]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [books, normalizedQuery]);
  const showHint = !normalizedQuery || results.length === 0;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        showHint && styles.centeredContent,
        showHint &&
          keyboardHeight > 0 && {
            // The native search controls sit above the keyboard, outside this React Native view.
            paddingBottom: keyboardHeight + spacing.xxl * 5,
          },
      ]}
    >
      {!normalizedQuery ? (
        <CenteredEmptyState
          variant="compact"
          title={t("search.hint", "Найдите книгу по названию или автору")}
        />
      ) : results.length === 0 ? (
        <CenteredEmptyState variant="compact" title={t("search.empty", "Ничего не найдено")} />
      ) : (
        <View style={styles.list}>
          {results.map((book, index) => (
            <View key={book.id}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={book.meta.title}
                activeOpacity={0.62}
                onPress={() => void openMobileBook({ bookId: book.id, navigation, t })}
                style={styles.row}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.title} numberOfLines={1}>
                    {book.meta.title}
                  </Text>
                  {book.meta.author ? (
                    <Text style={styles.author} numberOfLines={1}>
                      {book.meta.author}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
              {index < results.length - 1 ? <View style={styles.separator} /> : null}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    centeredContent: { justifyContent: "center" },
    list: {},
    row: { minHeight: 68, justifyContent: "center", paddingVertical: spacing.md },
    rowBody: { gap: 2 },
    title: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
    author: { color: colors.mutedForeground, fontSize: fontSize.sm },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  });
