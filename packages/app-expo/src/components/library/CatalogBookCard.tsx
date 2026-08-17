import { useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import { useColors } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Platform, StyleSheet, View } from "react-native";
import { makeStyles } from "./book-card-styles";
import { BookCoverTypography } from "./book-cover-typography";
import { PerspectiveBook } from "./perspective-book";

interface CatalogBookCardProps {
  title: string;
  author: string;
  coverUri?: string;
  cardWidth: number;
  isImporting: boolean;
  isInLibrary: boolean;
  onPress: () => void;
}

export function CatalogBookCard({
  title,
  author,
  coverUri,
  cardWidth,
  isImporting,
  isInLibrary,
  onPress,
}: CatalogBookCardProps) {
  const colors = useColors();
  const styles = makeStyles(colors, cardWidth);
  const { t } = useTranslation();
  const swipePressGuard = useSwipePressGuard();

  return (
    <PerspectiveBook
      width={cardWidth}
      height={cardWidth * (41 / 28)}
      accessibilityLabel={title}
      accessibilityHint={
        isInLibrary
          ? t("notes.openBook", "Открыть книгу")
          : t("library.catalogAdd", "Добавить в библиотеку")
      }
      disabled={isImporting}
      onPress={() => {
        if (swipePressGuard?.canPress() === false) return;
        onPress();
      }}
      cover={
        <View style={styles.coverCanvas}>
          {coverUri ? (
            <Image
              source={{ uri: coverUri }}
              style={styles.coverImage}
              resizeMode="cover"
              resizeMethod={Platform.OS === "android" ? "resize" : "auto"}
              fadeDuration={Platform.OS === "android" ? 0 : undefined}
            />
          ) : (
            <View style={styles.fallbackCover}>
              <BookCoverTypography
                title={title}
                author={author}
                width={cardWidth}
                textTone="light"
              />
            </View>
          )}
          {isImporting ? (
            <View style={localStyles.loadingOverlay}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
          {isInLibrary && !isImporting ? (
            <View style={[localStyles.libraryBadge, { backgroundColor: colors.primary }]} />
          ) : null}
        </View>
      }
    />
  );
}

const localStyles = StyleSheet.create({
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  libraryBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});
