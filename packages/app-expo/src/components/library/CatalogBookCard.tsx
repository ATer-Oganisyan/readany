import { RotateCcwIcon } from "@/components/ui/Icon";
import { useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import { generatedCoverTextTone } from "@/lib/book/cover-text-contrast";
import { countRender } from "@/lib/diagnostics/interaction-performance";
import { catalogCoverDisplayState } from "@/lib/narra/catalog-cover-state";
import { useColors } from "@/styles/theme";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Animated,
  Easing,
  type GestureResponderEvent,
  Image,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { CatalogBookSkeleton } from "./CatalogBookSkeleton";
import { BookCoverTypography } from "./book-cover-typography";
import { PerspectiveBook } from "./perspective-book";

interface CatalogBookCardProps {
  title: string;
  author: string;
  coverUri?: string;
  hasCover: boolean;
  coverLoadFailed?: boolean;
  shadowOpacity?: Animated.Value;
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
  shadowOpacity,
  cardWidth,
  onPress,
  onRetryCover,
}: CatalogBookCardProps) {
  countRender("catalog.card");
  const colors = useColors();
  const { t } = useTranslation();
  const swipePressGuard = useSwipePressGuard();
  const cardHeight = cardWidth * (41 / 28);
  const coverWidth = Math.max(cardWidth, 180);
  const coverScale = cardWidth / coverWidth;
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
  const reducedMotion = useReducedMotion();
  const revealProgress = useRef(new Animated.Value(0)).current;
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (isCoverReady && revealed) return;
    if (revealed) setRevealed(false);
    revealProgress.setValue(0);
    if (!isCoverReady) return;
    if (reducedMotion) {
      revealProgress.setValue(2);
      setRevealed(true);
      return;
    }
    const easeOut = Easing.bezier(0, 0, 0.58, 1);
    // One native clock: the second 100 ms phase never waits for the JS thread.
    const animation = Animated.timing(revealProgress, {
      toValue: 2,
      duration: 200,
      easing: (time) => (time < 0.5 ? easeOut(time * 2) / 2 : (1 + easeOut(time * 2 - 1)) / 2),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) setRevealed(true);
    });
    return () => animation.stop();
  }, [isCoverReady, reducedMotion, revealProgress, revealed]);
  const interactive = isCoverReady && revealed;
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
      {interactive ? null : (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.revealLayer,
            {
              opacity: revealProgress.interpolate({
                inputRange: [0, 1, 2],
                outputRange: [1, 0, 0],
              }),
              transform: [
                {
                  scale: revealProgress.interpolate({
                    inputRange: [0, 1, 2],
                    outputRange: [1, 0.96, 0.96],
                  }),
                },
              ],
            },
          ]}
        >
          <CatalogBookSkeleton cardWidth={cardWidth} />
        </Animated.View>
      )}
      <Animated.View
        pointerEvents={interactive ? "auto" : "none"}
        accessibilityElementsHidden={!interactive}
        importantForAccessibility={interactive ? "auto" : "no-hide-descendants"}
        style={[
          styles.revealLayer,
          {
            opacity: revealProgress.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, 1] }),
            transform: [
              {
                scale: revealProgress.interpolate({
                  inputRange: [0, 1, 2],
                  outputRange: [0.96, 0.96, 1],
                }),
              },
            ],
          },
          !isCoverReady && styles.hidden,
        ]}
      >
        <View style={cardSize}>
          <PerspectiveBook
            width={cardWidth}
            height={cardHeight}
            coverEffects={isCoverReady}
            showShadow={isCoverReady}
            shadowOpacity={shadowOpacity}
            disabled={!interactive}
            accessibilityLabel={title}
            accessibilityHint={t("notes.openBook", "Открыть книгу")}
            onPress={handlePress}
            cover={
              <View
                style={[
                  styles.coverCanvas,
                  {
                    width: coverWidth,
                    height: coverWidth * (41 / 28),
                    transformOrigin: "top left",
                    transform: [{ scale: coverScale }],
                  },
                ]}
              >
                {showImage ? (
                  <Image
                    key={coverUri}
                    source={coverSource}
                    style={styles.coverImage}
                    resizeMode="cover"
                    fadeDuration={0}
                    onLoad={handleLoad}
                    onError={handleError}
                  />
                ) : null}
                {/* Keep contrast preparation and the Image mounted, but create
                  no native text or surface effects behind the skeleton. */}
                <BookCoverTypography
                  title={title}
                  author={author}
                  width={coverWidth}
                  showText={isCoverReady}
                  textTone={showImage ? generatedCoverTextTone({ title, author }) : "light"}
                  coverUri={showImage ? coverUri : undefined}
                />
              </View>
            }
          />
        </View>
      </Animated.View>
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
  revealLayer: { ...StyleSheet.absoluteFill, transformOrigin: "center" },
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
