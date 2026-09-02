import { EmptyStateActionButton } from "@/components/ui/empty-state-action-button";
import { useBackendBook } from "@/hooks/use-backend-book";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import { retryBackendBookSync, useBackendBookStatus } from "@/lib/narra/backend-book-sync";
import { hasCharacterPortrait } from "@/lib/narra/character-portrait";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { ReaderCharacterCard } from "@/screens/reader/ReaderCharacterCard";
import { useLibraryStore, useNarraStore } from "@/stores";
import { type ThemeColors, useTheme } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useLayoutEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "NarraCharacterProfile">;

export function NarraCharacterProfileScreen({ route, navigation }: Props) {
  const { bookId, characterId, openedFromChat = false } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const book = useLibraryStore((state) => state.books.find((item) => item.id === bookId));
  useBackendBook(book);
  const backendStatus = useBackendBookStatus((state) => state.books[bookId]);
  const character = useNarraStore((state) =>
    state.books[bookId]?.characters.find((item) => item.id === characterId),
  );
  const androidTitle =
    Platform.OS === "android"
      ? character?.fullName || character?.name || t("narra.characterProfile", "Персонаж")
      : undefined;
  const portraitReady = Boolean(
    character?.backendManaged &&
      isCharacterUnlocked(book?.progress ?? 0, character) &&
      hasCharacterPortrait(character),
  );

  useLayoutEffect(() => {
    if (Platform.OS === "android") {
      navigation.setOptions({
        title: androidTitle,
        contentStyle: { backgroundColor: colors.card },
      });
      return;
    }

    navigation.setOptions({
      contentStyle: {
        backgroundColor: Platform.OS === "ios" ? "transparent" : colors.card,
      },
      sheetAllowedDetents: portraitReady ? [0.78, 1] : "fitToContents",
      sheetInitialDetentIndex: 0,
      sheetExpandsWhenScrolledToEdge: portraitReady,
      sheetResizeAnimationEnabled: true,
    });
  }, [androidTitle, colors.card, navigation, portraitReady]);
  const openChat = () => {
    if (openedFromChat) {
      navigation.goBack();
      return;
    }
    navigation.replace("NarraCharacterChat", { bookId, characterId });
  };

  const continueReading = () => {
    navigation.goBack();
    setTimeout(() => void openMobileBook({ bookId, navigation, t }), 0);
  };

  if (!character?.backendManaged) {
    return (
      <View collapsable={false} style={[styles.compactContainer, styles.pending]}>
        {backendStatus?.error || backendStatus?.manifest?.availability === "ready" ? (
          <EmptyStateActionButton
            label={t("common.retry", "Повторить")}
            onPress={() => retryBackendBookSync(bookId)}
          />
        ) : (
          <ActivityIndicator color={colors.mutedForeground} />
        )}
      </View>
    );
  }

  return (
    <View collapsable={false} style={[styles.container, !portraitReady && styles.compactContainer]}>
      <ReaderCharacterCard
        embedded
        staticPortraitOnly
        visible
        character={character}
        bookId={bookId}
        onClose={() => navigation.goBack()}
        onOpenChat={openChat}
        onContinueReading={continueReading}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: Platform.OS === "ios" ? "transparent" : colors.card,
    },
    compactContainer: {
      flex: 0,
      backgroundColor: Platform.OS === "ios" ? "transparent" : colors.card,
    },
    pending: {
      minHeight: 200,
      alignItems: "center",
      justifyContent: "center",
    },
  });
