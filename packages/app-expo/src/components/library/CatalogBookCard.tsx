import { Text } from "@/components/ui/Typography";
import { useColors } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from "react-native";
import { makeStyles } from "./book-card-styles";

interface CatalogBookCardProps {
  title: string;
  author: string;
  cardWidth: number;
  isImporting: boolean;
  isInLibrary: boolean;
  onPress: () => void;
}

export function CatalogBookCard({
  title,
  author,
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
        <View style={styles.fallbackCover}>
          <View style={styles.fallbackGradientTop} />
          <View style={styles.fallbackGradientBottom} />
          <View style={styles.fallbackContentOverlay}>
            <View style={styles.fallbackTitleWrap}>
              <Text style={styles.fallbackTitle} numberOfLines={4}>
                {title}
              </Text>
            </View>
            <View style={styles.fallbackDivider} />
            <View style={styles.fallbackAuthorWrap}>
              <Text style={styles.fallbackAuthor} numberOfLines={2}>
                {author}
              </Text>
            </View>
          </View>
        </View>

        {isImporting ? (
          <View style={localStyles.loadingOverlay}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : isInLibrary ? (
          <View style={[localStyles.statusBadge, { backgroundColor: colors.primary }]}>
            <Text style={[localStyles.statusText, { color: colors.primaryForeground }]}>
              {t("library.catalogAdded", "Добавлено")}
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
  statusBadge: {
    position: "absolute",
    right: 8,
    bottom: 8,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: { fontSize: 10, fontWeight: "600" },
});
