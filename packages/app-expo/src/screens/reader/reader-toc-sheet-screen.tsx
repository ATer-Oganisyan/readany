import { getStrokeIconImageSource } from "@/components/ui/MishanaerIcon";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useTheme } from "@/styles/theme";
import { Header } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet, View } from "react-native";
import { ReaderTOCPanel } from "./ReaderTOCPanel";
import { ReaderTOCSheetCloseButton } from "./ReaderTOCSheetCloseButton";
import { ReaderBookmarksPanel } from "./reader-bookmarks-panel";
import { useReaderTOCSheet } from "./reader-toc-sheet-context";

type Props = NativeStackScreenProps<RootStackParamList, "ReaderTOC">;

export function ReaderTOCSheetScreen({ navigation, route }: Props) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { session } = useReaderTOCSheet();
  const bookmarksMode = route.params?.tab === "bookmarks";
  const handleClose = useCallback(() => {
    if (session) {
      session.onClose();
      return;
    }
    navigation.goBack();
  }, [navigation, session]);

  useLayoutEffect(() => {
    navigation.setOptions({
      contentStyle: { backgroundColor: colors.card },
      headerShown: true,
      headerBackVisible: false,
      headerTitle: bookmarksMode ? t("bookmarks.title", "Закладки") : t("reader.toc", "Оглавление"),
      headerTitleAlign: "center",
      ...(Platform.OS === "ios"
        ? {
            header: undefined,
            headerRight: undefined,
            unstable_headerRightItems: () => [
              {
                type: "button" as const,
                label: t("common.close", "Закрыть"),
                accessibilityLabel: t("common.close", "Закрыть"),
                icon: {
                  type: "image" as const,
                  source: getStrokeIconImageSource("x"),
                },
                onPress: handleClose,
              },
            ],
          }
        : {
            // Android formSheet does not attach the native toolbar. Render the
            // navigator's standard header, retaining its title/theme and Close.
            header: ({ options }) => (
              <Header
                title={
                  bookmarksMode ? t("bookmarks.title", "Закладки") : t("reader.toc", "Оглавление")
                }
                headerTitleAlign="center"
                headerStatusBarHeight={0}
                headerStyle={{ backgroundColor: colors.card }}
                headerTitleStyle={options.headerTitleStyle}
                headerTintColor={colors.foreground}
                headerShadowVisible={false}
                headerRight={() => (
                  <ReaderTOCSheetCloseButton
                    accessibilityLabel={t("common.close", "Закрыть")}
                    colorScheme={isDark ? "dark" : "light"}
                    foregroundColor={colors.foreground}
                    onPress={handleClose}
                  />
                )}
              />
            ),
            unstable_headerRightItems: undefined,
            headerRight: () => (
              <ReaderTOCSheetCloseButton
                accessibilityLabel={t("common.close", "Закрыть")}
                colorScheme={isDark ? "dark" : "light"}
                foregroundColor={colors.foreground}
                onPress={handleClose}
              />
            ),
          }),
    });
  }, [bookmarksMode, colors.card, colors.foreground, handleClose, isDark, navigation, t]);

  if (!session) {
    return <View style={[styles.container, { backgroundColor: colors.card }]} />;
  }

  return (
    <View collapsable={false} style={[styles.container, { backgroundColor: colors.card }]}>
      {bookmarksMode ? (
        <ReaderBookmarksPanel
          bookId={session.bookId}
          onSelectCfi={(cfi) => session.onSelectBookmark?.(cfi)}
        />
      ) : (
        <ReaderTOCPanel
          toc={session.toc}
          currentChapter={session.currentChapter}
          onSelectTocItem={session.onSelectTocItem}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
