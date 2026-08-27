import { useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import { NativeButton } from "@/components/ui/NativeButton";
import { generatedCoverTextTone } from "@/lib/book/cover-text-contrast";
import { catalogCoverDisplayState } from "@/lib/narra/catalog-cover-state";
import { useColors } from "@/styles/theme";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, StyleSheet, View } from "react-native";
import { CatalogBookSkeleton } from "./CatalogBookSkeleton";
import { makeStyles } from "./book-card-styles";
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

export function CatalogBookCard({
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
  const colors = useColors();
  const styles = makeStyles(colors, cardWidth);
  const { t } = useTranslation();
  const swipePressGuard = useSwipePressGuard();
  const cardHeight = cardWidth * (41 / 28);

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

  return (
    <View style={{ width: cardWidth, height: cardHeight }}>
      {/* Until the actual image is decoded, show only the neutral skeleton.
          No colored book, fade-out, or second placeholder between states. */}
      {isCoverReady ? null : (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <CatalogBookSkeleton cardWidth={cardWidth} />
        </View>
      )}
      <View
        pointerEvents={isCoverReady ? "auto" : "none"}
        accessibilityElementsHidden={!isCoverReady}
        importantForAccessibility={isCoverReady ? "auto" : "no-hide-descendants"}
        style={[
          StyleSheet.absoluteFill,
          {
            opacity: isCoverReady ? 1 : 0,
          },
        ]}
      >
        <PerspectiveBook
          width={cardWidth}
          height={cardHeight}
          accessibilityLabel={title}
          accessibilityHint={
            isInLibrary
              ? t("notes.openBook", "Открыть книгу")
              : t("library.catalogAdd", "Добавить в библиотеку")
          }
          onPress={() => {
            if (swipePressGuard?.canPress() === false) return;
            onPress();
          }}
          cover={
            <View style={styles.coverCanvas}>
              {showImage ? (
                <Image
                  key={coverUri}
                  source={{ uri: coverUri }}
                  style={styles.coverImage}
                  resizeMode="cover"
                  onLoad={() => {
                    if (coverUri && currentCoverUri.current === coverUri)
                      setDecodedCoverUri(coverUri);
                  }}
                  onError={() => {
                    if (coverUri && currentCoverUri.current === coverUri)
                      setFailedCoverUri(coverUri);
                  }}
                />
              ) : null}
              <BookCoverTypography
                title={title}
                author={author}
                width={cardWidth}
                textTone={showImage ? generatedCoverTextTone({ title, author }) : "light"}
                coverUri={showImage ? coverUri : undefined}
              />
            </View>
          }
        />
      </View>
      {display === "error" ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
          <NativeButton
            label={t("common.retry", "Повторить")}
            accessibilityLabel={`${t("common.retry", "Повторить")}: ${title}`}
            onPress={() => {
              if (swipePressGuard?.canPress() === false) return;
              setDecodedCoverUri(null);
              setFailedCoverUri(null);
              onRetryCover();
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
