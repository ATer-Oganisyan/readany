import { Text } from "@/components/ui/Typography";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { ReaderCharacterCard } from "@/screens/reader/ReaderCharacterCard";
import { useNarraStore } from "@/stores";
import { type ThemeColors, fontSize, spacing, useTheme } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMemo } from "react";
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
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>
          {t("narra.characterUnavailable", "Персонаж недоступен.")}
        </Text>
      </View>
    );
  }

  return (
    <View collapsable={false} style={styles.container}>
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
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
      backgroundColor: colors.background,
    },
    emptyText: {
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
      textAlign: "center",
    },
  });
