import { Text } from "@/components/ui/Typography";
import { useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import { generatedCoverTextTone } from "@/lib/book/cover-text-contrast";
import { useColors } from "@/styles/theme";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { CatalogBookSkeleton } from "./CatalogBookSkeleton";
import { makeStyles } from "./book-card-styles";
import { BookCoverTypography } from "./book-cover-typography";
import { PerspectiveBook } from "./perspective-book";

/** Обложка проявляется за 200 мс: заметно, но не задерживает просмотр. */
const COVER_FADE_MS = 200;

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
  const cardHeight = cardWidth * (41 / 28);

  // Книга показывается только когда файл обложки уже раскодирован: иначе
  // карточка успевает мигнуть подложкой под ещё не отрисованной картинкой.
  const [decodedCoverUri, setDecodedCoverUri] = useState<string | null>(null);
  const isCoverReady = Boolean(coverUri) && decodedCoverUri === coverUri;

  useEffect(() => {
    // Обложку перегенерировали — ждём загрузки новой, старую не показываем.
    if (!coverUri) setDecodedCoverUri(null);
  }, [coverUri]);

  return (
    <View style={{ width: cardWidth, height: cardHeight }}>
      {/* Заглушка уходит, обложка приходит — обе меняют только opacity,
          поэтому раскладка не пересчитывается и тень не дёргается. */}
      {isCoverReady ? null : (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { transitionProperty: "opacity", transitionDuration: COVER_FADE_MS },
          ]}
        >
          <CatalogBookSkeleton cardWidth={cardWidth} />
        </Animated.View>
      )}
      <Animated.View
        pointerEvents={isCoverReady ? "auto" : "none"}
        style={[
          StyleSheet.absoluteFill,
          {
            opacity: isCoverReady ? 1 : 0,
            transitionProperty: "opacity",
            transitionDuration: COVER_FADE_MS,
            transitionTimingFunction: "ease-out",
          },
        ]}
      >
        <PerspectiveBook
          width={cardWidth}
          height={cardHeight}
          accessibilityLabel={title}
          accessibilityHint={
            isImporting
              ? t("library.catalogImportInProgressTitle", "Книга уже загружается")
              : isInLibrary
                ? t("notes.openBook", "Открыть книгу")
                : t("library.catalogAdd", "Добавить в библиотеку")
          }
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
                  onLoad={() => setDecodedCoverUri(coverUri)}
                />
              ) : (
                <View style={styles.fallbackCover} />
              )}
              <BookCoverTypography
                title={title}
                author={author}
                width={cardWidth}
                textTone={coverUri ? generatedCoverTextTone({ title, author }) : "dark"}
              />
              {isImporting ? (
                <View pointerEvents="none" style={styles.downloadingOverlay}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.downloadingOverlayText}>
                    {t("library.catalogImporting", "Загружаем…")}
                  </Text>
                </View>
              ) : null}
            </View>
          }
        />
      </Animated.View>
    </View>
  );
}
