import { Text } from "@/components/ui/Typography";
import { useColors } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, StyleSheet, TouchableOpacity, View } from "react-native";
import { makeStyles } from "./book-card-styles";

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

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={
        isInLibrary
          ? t("notes.openBook", "Открыть книгу")
          : t("library.catalogAdd", "Добавить в библиотеку")
      }
      activeOpacity={0.7}
      disabled={isImporting}
      onPress={onPress}
      style={styles.container}
    >
      <View style={styles.coverWrap}>
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={styles.coverImage} resizeMode="cover" />
        ) : (
          <View style={styles.fallbackCover}>
            <Text style={styles.fallbackTitle} numberOfLines={6}>
              {title}
            </Text>
          </View>
        )}

        {isImporting ? (
          <View style={localStyles.loadingOverlay}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
        {isInLibrary && !isImporting ? (
          <View style={[localStyles.libraryBadge, { backgroundColor: colors.primary }]}>
            <Text style={[localStyles.libraryBadgeText, { color: colors.primaryForeground }]}>
              {t("library.catalogInLibrary", "В библиотеке")}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.infoWrap}>
        <Text style={styles.bookTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.bookAuthor} numberOfLines={1}>
          {author}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const localStyles = StyleSheet.create({
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  libraryBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  libraryBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
});
