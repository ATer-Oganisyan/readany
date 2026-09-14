import { RotateCcwIcon } from "@/components/ui/Icon";
import { useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import { generatedCoverTextTone } from "@/lib/book/cover-text-contrast";
import { countRender } from "@/lib/diagnostics/interaction-performance";
import { catalogCoverDisplayState } from "@/lib/narra/catalog-cover-state";
import { useColors } from "@/styles/theme";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type GestureResponderEvent, Image, Pressable, StyleSheet, View } from "react-native";
import { CatalogBookSkeleton } from "./CatalogBookSkeleton";
import { BookCoverTypography } from "./book-cover-typography";
import { PerspectiveBook } from "./perspective-book";

interface CatalogBookCardProps {
  title: string;
  author: string;
  coverUri?: string;
  hasCover: boolean;
  coverLoadFailed?: boolean;
  cardWidth: number;
  isInLibrary: boolean;
  onPress: () => void;
  onRetryCover: () => void;
}

export const CatalogBookCard = memo(function CatalogBookCard({
  title,
  author,
  coverUri,
  hasCover,
  coverLoadFailed,
  cardWidth,
  isInLibrary,
  onPress,
  onRetryCover,
}: CatalogBookCardProps) {
  countRender("catalog.card");
  const colors = useColors();
  const { t } = useTranslation();
  const swipePressGuard = useSwipePressGuard();
  const cardHeight = cardWidth * (41 / 28);
  const cardSize = useMemo(
    () => ({ width: cardWidth, height: cardHeight }),
    [cardWidth, cardHeight],
  );
  const coverSource = useMemo(() => ({ uri: coverUri }), [coverUri]);
  const [decodedCoverUri, setDecodedCoverUri] = useState<string | null>(null);
  const [failedCoverUri, setFailedCoverUri] = useState<string | null>(null);
  const currentCoverUri = useRef(coverUri);
  currentCoverUri.current = coverUri;
  const display = catalogCoverDisplayState({
    hasCover,
    coverUri,
    decodedCoverUri,
    failedCoverUri,
    downloadFailed: coverLoadFailed,
  });
  const isCoverReady = display === "image";
  const showImage = !!coverUri && failedCoverUri !== coverUri;
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (swipePressGuard?.canPress(event) === false) return;
      onPress();
    },
    [swipePressGuard, onPress],
  );
  const handleLoad = useCallback(() => {
    if (coverUri && currentCoverUri.current === coverUri) setDecodedCoverUri(coverUri);
  }, [coverUri]);
  const handleError = useCallback(() => {
    if (coverUri && currentCoverUri.current === coverUri) setFailedCoverUri(coverUri);
  }, [coverUri]);
  const handleRetry = useCallback(
    (event?: GestureResponderEvent) => {
      if (swipePressGuard?.canPress(event) === false) return;
      setDecodedCoverUri(null);
      setFailedCoverUri(null);
      onRetryCover();
    },
    [swipePressGuard, onRetryCover],
  );

  return (
    <View style={cardSize}>
      {isCoverReady ? null : (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <CatalogBookSkeleton cardWidth={cardWidth} />
        </View>
      )}
      <View
        pointerEvents={isCoverReady ? "auto" : "none"}
        accessibilityElementsHidden={!isCoverReady}
        importantForAccessibility={isCoverReady ? "auto" : "no-hide-descendants"}
        style={[StyleSheet.absoluteFill, !isCoverReady && styles.hidden]}
      >
        <PerspectiveBook
          width={cardWidth}
          height={cardHeight}
          coverEffects={isCoverReady}
          showShadow={isCoverReady}
          disabled={!isCoverReady}
          accessibilityLabel={title}
          accessibilityHint={
            isInLibrary
              ? t("notes.openBook", "Открыть книгу")
              : t("library.catalogAdd", "Добавить в библиотеку")
          }
          onPress={handlePress}
          cover={
            <View style={styles.coverCanvas}>
              {showImage ? (
                <Image
                  key={coverUri}
                  source={coverSource}
                  style={styles.coverImage}
                  resizeMode="cover"
                  onLoad={handleLoad}
                  onError={handleError}
                />
              ) : null}
              {/* Keep contrast preparation and the Image mounted, but create
                  no native text or surface effects behind the skeleton. */}
              <BookCoverTypography
                title={title}
                author={author}
                width={cardWidth}
                showText={isCoverReady}
                textTone={showImage ? generatedCoverTextTone({ title, author }) : "light"}
                coverUri={showImage ? coverUri : undefined}
              />
            </View>
          }
        />
      </View>
      {display === "error" ? (
        <View style={styles.retry}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("common.retry", "Повторить")}: ${title}`}
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryPressed]}
            onPress={handleRetry}
          >
            <RotateCcwIcon size={32} color={colors.primary30} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  coverCanvas: {
    width: "100%",
    height: "100%",
    position: "relative",
    isolation: "isolate",
  },
  coverImage: { width: "100%", height: "100%" },
  retry: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  retryPressed: { transform: [{ scale: 0.96 }] },
});
