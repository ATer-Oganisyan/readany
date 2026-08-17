import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import { hasCharacterPortrait } from "@/lib/narra/character-portrait";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { ReaderCharacterCard } from "@/screens/reader/ReaderCharacterCard";
import { useNarraStore } from "@/stores";
import { type ThemeColors, useTheme } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useLayoutEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "NarraCharacterProfile">;

export function NarraCharacterProfileScreen({ route, navigation }: Props) {
  const { bookId, characterId, openedFromChat = false } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const character = useNarraStore((state) =>
    state.books[bookId]?.characters.find((item) => item.id === characterId),
  );
  const portraitReady = Boolean(character && hasCharacterPortrait(character));

  useLayoutEffect(() => {
    navigation.setOptions({
      contentStyle: {
        backgroundColor: portraitReady ? colors.background : "#2C2219",
      },
      sheetAllowedDetents: portraitReady ? [0.78, 1] : "fitToContents",
      sheetInitialDetentIndex: 0,
      sheetExpandsWhenScrolledToEdge: portraitReady,
      sheetResizeAnimationEnabled: true,
    });
  }, [colors.background, navigation, portraitReady]);
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

  if (!character) {
    return (
      <CenteredEmptyState
        title={t("narra.characterUnavailable", "Персонаж недоступен.")}
        style={styles.emptyState}
      />
    );
  }

  return (
    <View collapsable={false} style={[styles.container, !portraitReady && styles.compactContainer]}>
      <ReaderCharacterCard
        embedded
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
    container: { flex: 1, backgroundColor: colors.background },
    compactContainer: { flex: 0, backgroundColor: "#2C2219" },
    emptyState: {
      flex: 1,
      backgroundColor: colors.background,
    },
  });
