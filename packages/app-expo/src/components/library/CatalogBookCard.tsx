import { useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import { generatedCoverPlaceholderColor } from "@/lib/book/cover-text-contrast";
import { useColors } from "@/styles/theme";
import { useEffect, useRef, useState } from "react";
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
  coverRequestKey?: string;
  onCoverNeeded?: () => void;
  onPress: () => void;
}

export function CatalogBookCard({
  title,
  author,
  coverUri,
  cardWidth,
  isImporting,
  isInLibrary,
  coverRequestKey,
  onCoverNeeded,
  onPress,
}: CatalogBookCardProps) {
  const colors = useColors();
  const styles = makeStyles(colors, cardWidth);
  const { t } = useTranslation();
  const swipePressGuard = useSwipePressGuard();
  const requestedCoverKey = useRef<string | undefined>(undefined);
  const [failedCoverUri, setFailedCoverUri] = useState<string>();
  const coverIdentity = { title, author };
  const placeholderColor = generatedCoverPlaceholderColor(coverIdentity);
  const visibleCoverUri = coverUri === failedCoverUri ? undefined : coverUri;

  useEffect(() => {
    if (coverUri) requestedCoverKey.current = undefined;
  }, [coverUri]);

  useEffect(() => {
    if (visibleCoverUri || !coverRequestKey || requestedCoverKey.current === coverRequestKey)
      return;
    requestedCoverKey.current = coverRequestKey;
    onCoverNeeded?.();
  }, [coverRequestKey, onCoverNeeded, visibleCoverUri]);

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
          {visibleCoverUri ? (
            <Image
              source={{ uri: visibleCoverUri }}
              style={styles.coverImage}
              resizeMode="cover"
              resizeMethod={Platform.OS === "android" ? "resize" : "auto"}
              fadeDuration={Platform.OS === "android" ? 0 : undefined}
              onError={() => setFailedCoverUri(visibleCoverUri)}
            />
          ) : (
            <View style={[styles.fallbackCover, { backgroundColor: placeholderColor }]} />
          )}
          <BookCoverTypography title={title} author={author} width={cardWidth} textTone="light" />
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
