import { Text } from "@/components/ui/Typography";
import { useColors } from "@/styles/theme";
import { type TTSConfig, type TTSPlayState, buildNarrationPreview } from "@readany/core/tts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Platform,
  PlatformColor,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TTSNativePlayer } from "./tts/TTSNativePlayer";
import { TTSPageSheet } from "./tts/TTSPageSheet";
import { SH, makeStyles } from "./tts/tts-page-styles";

// ── Props ─────────────────────────────────────────────────────────────────────

interface TTSPageProps {
  visible: boolean;
  bookTitle: string;
  chapterTitle: string;
  coverUri?: string;
  playState: TTSPlayState;
  currentText: string;
  config: TTSConfig;
  readingProgress: number;
  currentPage: number;
  totalPages: number;
  sourceLabel: string;
  continuousEnabled: boolean;
  narrationSegments?: Array<{ text: string; cfi?: string | null }>;
  /** Sentences from the previously-read page, shown above current page sentences */
  prevNarrationSegments?: Array<{ text: string; cfi?: string | null }>;
  currentSegmentCfi?: string | null;
  currentSegmentText?: string | null;
  currentChunkIndex?: number;
  totalChunks?: number;
  chapterCurrentIndex?: number;
  chapterTotalChunks?: number;
  onClose: () => void;
  onReturnToReading?: () => void | Promise<void>;
  onReplay: () => void | Promise<void>;
  onPlayPause: () => void | Promise<void>;
  onStop: () => void;
  onAdjustRate: (delta: number) => void;
  onAdjustPitch: (delta: number) => void;
  onToggleContinuous: () => void;
  /**
   * Called when user taps a lyric line.
   * `offsetFromCurrent` is 0-based within the current page segments;
   * negative values mean a sentence from the previous page.
   */
  onJumpToSegment?: (offsetFromCurrent: number) => void;
  onJumpToLyricSegment?: (
    segment: { text: string; cfi?: string | null },
    offsetFromCurrent: number,
  ) => void | Promise<void>;
  onLoadMoreAbove?: () => void | Promise<void>;
  onLoadMoreBelow?: () => void | Promise<void>;
  onSeekChapterChunk?: (index: number) => void | Promise<void>;
  onUpdateConfig?: (updates: Partial<TTSConfig>) => void;
  onPrevChapter?: () => void | Promise<void>;
  onNextChapter?: () => void | Promise<void>;
}

// ── Component ─────────────────────────────────────────────────────────────────

/** Пресеты скорости озвучки в мини-панели плеера (P7). */
const TTS_SPEED_PRESETS: readonly number[] = [0.75, 1, 1.25, 1.5];

export function TTSPage({
  visible,
  playState,
  currentText,
  config,
  continuousEnabled,
  narrationSegments = [],
  prevNarrationSegments = [],
  currentSegmentCfi,
  currentSegmentText,
  currentChunkIndex = 0,
  chapterCurrentIndex,
  chapterTotalChunks,
  onClose,
  onPlayPause,
  onStop,
  onUpdateConfig,
  onJumpToSegment,
  onJumpToLyricSegment,
  onLoadMoreAbove,
  onLoadMoreBelow,
  onSeekChapterChunk,
}: TTSPageProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const lyricScrollRef = useRef<ScrollView>(null);
  const lyricLayoutRef = useRef(new Map<string, { y: number; height: number }>());
  const lastCenteredSignatureRef = useRef<string | null>(null);
  const userScrollingRef = useRef(false);
  const userScrollUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreAboveLockRef = useRef(false);
  const loadMoreBelowLockRef = useRef(false);
  const loadMoreAboveArmedRef = useRef(true);
  const loadMoreBelowArmedRef = useRef(true);
  const autoScrollLockUntilRef = useRef(0);

  const fallbackPreview = useMemo(() => buildNarrationPreview(currentText), [currentText]);

  // Measured height of the lyricArea — used to compute paddingBottom so the
  // last sentence can always scroll to the vertical center of the list.
  const [lyricAreaHeight, setLyricAreaHeight] = useState(SH * 0.4);
  const onLyricAreaLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const nextHeight = e.nativeEvent.layout.height;
    // Ignore transient tiny heights during modal open/close animation.
    if (nextHeight < 120) return;
    setLyricAreaHeight((prev) => (Math.abs(prev - nextHeight) > 2 ? nextHeight : prev));
  }, []);

  // Number of prev-page sentences prepended to the list (only used in fallback mode)
  // Number of prev-page sentences prepended to the list
  const prevCount =
    prevNarrationSegments?.filter((segment) => segment.text.trim().length > 0).length ?? 0;
  const lyricSegments = useMemo(() => {
    const keyCounts = new Map<string, number>();
    const toLyricItem = (
      prefix: "prev" | "curr",
      segment: { text: string; cfi?: string | null },
      index: number,
    ) => {
      const fallbackKey = segment.text.trim().slice(0, 32) || `line-${index}`;
      const baseKey = segment.cfi
        ? `${prefix}:${segment.cfi}`
        : `${prefix}:${index}:${fallbackKey}`;
      const occurrence = keyCounts.get(baseKey) ?? 0;
      keyCounts.set(baseKey, occurrence + 1);
      return {
        id: `${baseKey}:${occurrence}`,
        text: segment.text,
        cfi: segment.cfi ?? null,
      };
    };

    const prev = (prevNarrationSegments ?? [])
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment, index) => toLyricItem("prev", segment, index));
    const curr = (narrationSegments ?? [])
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment, index) => toLyricItem("curr", segment, index));
    if (prev.length > 0 || curr.length > 0) {
      return [...prev, ...curr];
    }
    return currentText ? [{ id: "fallback:current-text", text: currentText, cfi: null }] : [];
  }, [currentText, narrationSegments, prevNarrationSegments]);
  // Prefer the actual spoken segment CFI so lyric centering doesn't reset when
  // the visible/current arrays are sliced or rebuilt around the current sentence.
  const safeChunkIndex = useMemo(() => {
    if (!lyricSegments.length) return 0;
    const normalizedCurrentText = currentSegmentText?.trim() || "";
    if (currentSegmentCfi || normalizedCurrentText) {
      const currentIndex = lyricSegments.findIndex((segment) => {
        if (currentSegmentCfi && segment.cfi !== currentSegmentCfi) return false;
        if (normalizedCurrentText && segment.text.trim() !== normalizedCurrentText) return false;
        return true;
      });
      if (currentIndex >= 0) {
        return currentIndex;
      }
    }
    const actualPrevCount = lyricSegments.filter((s) => s.id.startsWith("prev:")).length;
    const prevCountStale = prevCount !== actualPrevCount;
    if (prevCountStale) {
      const cfiInCurr = narrationSegments
        ? narrationSegments.findIndex((s) => {
            if (currentSegmentCfi && s.cfi !== currentSegmentCfi) return false;
            if (normalizedCurrentText && s.text.trim() !== normalizedCurrentText) return false;
            return true;
          })
        : -1;
      if (cfiInCurr >= 0) {
        return Math.min(actualPrevCount + cfiInCurr, lyricSegments.length - 1);
      }
      return Math.min(actualPrevCount, lyricSegments.length - 1);
    }
    const fallback = prevCount + currentChunkIndex;
    if (fallback < lyricSegments.length) {
      return Math.max(0, fallback);
    }
    const cfiInCurr = narrationSegments
      ? narrationSegments.findIndex((s) => {
          if (currentSegmentCfi && s.cfi !== currentSegmentCfi) return false;
          if (normalizedCurrentText && s.text.trim() !== normalizedCurrentText) return false;
          return true;
        })
      : -1;
    if (cfiInCurr >= 0) {
      return prevCount + cfiInCurr;
    }
    return Math.max(0, Math.min(prevCount, lyricSegments.length - 1));
  }, [
    currentChunkIndex,
    currentSegmentCfi,
    currentSegmentText,
    lyricSegments,
    narrationSegments,
    prevCount,
  ]);
  const lyricCenterPadding = useMemo(
    () => Math.max(40, Math.round(lyricAreaHeight / 2 - 32)),
    [lyricAreaHeight],
  );
  const currentExcerpt = lyricSegments[safeChunkIndex]?.text || fallbackPreview.currentExcerpt;
  const centerLyricIndex = useCallback(
    (index: number, animated = true) => {
      const id = lyricSegments[index]?.id;
      const layout = id ? lyricLayoutRef.current.get(id) : undefined;
      if (layout) {
        const targetOffset = Math.max(
          0,
          lyricCenterPadding + layout.y - (lyricAreaHeight - layout.height) / 2,
        );
        autoScrollLockUntilRef.current = Date.now() + (animated ? 800 : 250);
        if (__DEV__) {
          console.log("[TTSPage][lyrics] center", {
            index,
            animated,
            layoutY: layout.y,
            layoutHeight: layout.height,
            lyricAreaHeight,
            lyricCenterPadding,
            targetOffset,
          });
        }
        lyricScrollRef.current?.scrollTo({
          y: targetOffset,
          x: 0,
          animated,
        });
        return;
      }
      const estimatedOffset = Math.max(
        0,
        lyricCenterPadding + index * 44 - lyricAreaHeight / 2 + 22,
      );
      autoScrollLockUntilRef.current = Date.now() + (animated ? 800 : 250);
      if (__DEV__) {
        console.log("[TTSPage][lyrics] center-estimated", {
          index,
          animated,
          lyricAreaHeight,
          lyricCenterPadding,
          estimatedOffset,
        });
      }
      lyricScrollRef.current?.scrollTo({
        y: estimatedOffset,
        x: 0,
        animated,
      });
    },
    [lyricAreaHeight, lyricCenterPadding, lyricSegments],
  );

  const isPlaying = playState === "playing";
  const isLoading = playState === "loading";
  const shouldAutoCenterLyrics = isPlaying || isLoading;
  const chromeBottomInset =
    Platform.OS === "android" ? Math.max(insets.bottom, 6) : Math.max(insets.bottom, 10);

  const pendingCenterRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) {
      pendingCenterRef.current = null;
      lastCenteredSignatureRef.current = null;
      userScrollingRef.current = false;
      autoScrollLockUntilRef.current = 0;
      loadMoreAboveArmedRef.current = true;
      loadMoreBelowArmedRef.current = true;
      return;
    }

    // Keep the measured lyric row layouts when the sheet is temporarily closed.
    // Re-mounting / clearing this cache was causing the mobile lyric list to
    // reflow as one collapsed block before the next layout pass completed.
    pendingCenterRef.current = null;
    lastCenteredSignatureRef.current = null;
    userScrollingRef.current = false;
    autoScrollLockUntilRef.current = 0;
    loadMoreAboveArmedRef.current = true;
    loadMoreBelowArmedRef.current = true;
  }, [visible]);

  useEffect(() => {
    // Keep layout entries that still exist in the current segment list; evict stale ones.
    const currentIds = new Set(lyricSegments.map((s) => s.id));
    for (const key of lyricLayoutRef.current.keys()) {
      if (!currentIds.has(key)) {
        lyricLayoutRef.current.delete(key);
      }
    }
    pendingCenterRef.current = null;
    loadMoreAboveArmedRef.current = true;
    loadMoreBelowArmedRef.current = true;
  }, [lyricSegments]);

  useEffect(() => {
    if (!visible || lyricSegments.length <= 1) return;
    if (!shouldAutoCenterLyrics) return;
    if (userScrollingRef.current) return;
    const targetIndex = Math.max(0, Math.min(safeChunkIndex, lyricSegments.length - 1));
    const centerSignature = `${targetIndex}:${currentSegmentCfi || ""}:${Math.round(lyricAreaHeight)}`;
    if (lastCenteredSignatureRef.current === centerSignature) return;
    if (__DEV__) {
      console.log("[TTSPage][lyrics] active-changed", {
        currentSegmentCfi,
        currentChunkIndex,
        safeChunkIndex: targetIndex,
        lyricSegmentsLength: lyricSegments.length,
      });
    }
    const targetId = lyricSegments[targetIndex]?.id;
    if (targetId && lyricLayoutRef.current.has(targetId)) {
      const timer = setTimeout(() => {
        if (!shouldAutoCenterLyrics) return;
        lastCenteredSignatureRef.current = centerSignature;
        centerLyricIndex(targetIndex, true);
      }, 80);
      return () => clearTimeout(timer);
    }
    pendingCenterRef.current = targetIndex;
  }, [
    centerLyricIndex,
    currentChunkIndex,
    currentSegmentCfi,
    lyricAreaHeight,
    lyricSegments,
    safeChunkIndex,
    shouldAutoCenterLyrics,
    visible,
  ]);

  useEffect(() => {
    return () => {
      if (userScrollUnlockTimerRef.current) {
        clearTimeout(userScrollUnlockTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!__DEV__) return;
    if (!visible) return;
    if (lyricSegments.length > 1) return;
    console.log("[TTSPage][lyrics] fallback-render", {
      lyricSegmentsLength: lyricSegments.length,
      narrationSegmentsLength: narrationSegments.length,
      prevNarrationSegmentsLength: prevNarrationSegments?.length ?? 0,
      currentSegmentCfi,
      currentSegmentTextLength: (currentSegmentText || "").length,
      currentTextLength: currentText.length,
    });
  }, [
    currentSegmentCfi,
    currentSegmentText,
    currentText,
    lyricSegments.length,
    narrationSegments.length,
    prevNarrationSegments?.length,
    visible,
  ]);

  const markUserScrolling = useCallback(() => {
    userScrollingRef.current = true;
    if (userScrollUnlockTimerRef.current) {
      clearTimeout(userScrollUnlockTimerRef.current);
      userScrollUnlockTimerRef.current = null;
    }
  }, []);

  const releaseUserScrolling = useCallback(() => {
    if (userScrollUnlockTimerRef.current) {
      clearTimeout(userScrollUnlockTimerRef.current);
    }
    userScrollUnlockTimerRef.current = setTimeout(() => {
      userScrollingRef.current = false;
    }, 900);
  }, []);

  const handleLyricPress = useCallback(
    (segment: { text: string; cfi?: string | null }, index: number) => {
      const offsetFromCurrent = index - prevCount;
      if (onJumpToLyricSegment) {
        onJumpToLyricSegment(segment, offsetFromCurrent);
        return;
      }
      onJumpToSegment?.(offsetFromCurrent);
    },
    [onJumpToLyricSegment, onJumpToSegment, prevCount],
  );

  const triggerLoadMoreAbove = useCallback(() => {
    if (!onLoadMoreAbove || loadMoreAboveLockRef.current) return;
    loadMoreAboveLockRef.current = true;
    onLoadMoreAbove();
    setTimeout(() => {
      loadMoreAboveLockRef.current = false;
    }, 350);
  }, [onLoadMoreAbove]);

  const triggerLoadMoreBelow = useCallback(() => {
    if (!onLoadMoreBelow || loadMoreBelowLockRef.current) return;
    loadMoreBelowLockRef.current = true;
    onLoadMoreBelow();
    setTimeout(() => {
      loadMoreBelowLockRef.current = false;
    }, 350);
  }, [onLoadMoreBelow]);

  // Proactive load-more: when the active segment is near the end of the list
  // (and we haven't locked), trigger below-load even if the list isn't scrollable.
  const proactiveLoadBelowFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      proactiveLoadBelowFiredRef.current = null;
      return;
    }
    if (!onLoadMoreBelow) return;
    if (lyricSegments.length <= 1) return;
    const nearEnd = safeChunkIndex >= lyricSegments.length - 2;
    if (!nearEnd) return;
    const dedupeKey = lyricSegments[lyricSegments.length - 1]?.id ?? "";
    if (proactiveLoadBelowFiredRef.current === dedupeKey) return;
    proactiveLoadBelowFiredRef.current = dedupeKey;
    if (__DEV__) {
      console.log("[TTSPage][lyrics] proactive load-more-below", {
        safeChunkIndex,
        lyricSegmentsLength: lyricSegments.length,
      });
    }
    triggerLoadMoreBelow();
  }, [lyricSegments, onLoadMoreBelow, safeChunkIndex, triggerLoadMoreBelow, visible]);

  // ── PanResponder listener removed — replaced by native ScrollView paging ──

  const s = makeStyles(colors);
  const sheetBackground =
    Platform.OS === "ios" ? PlatformColor("systemBackground") : colors.background;

  return (
    <TTSPageSheet visible={visible} onClose={onClose}>
      <View style={[s.screen, { backgroundColor: sheetBackground }]}>
        <View style={[s.content, { backgroundColor: sheetBackground }]}>
          <View style={s.lyricArea} onLayout={onLyricAreaLayout}>
            {lyricSegments.length > 0 ? (
              <ScrollView
                ref={lyricScrollRef}
                style={s.lyricList}
                contentContainerStyle={[
                  s.lyricListContent,
                  {
                    paddingTop: lyricCenterPadding,
                    paddingBottom: lyricCenterPadding,
                    minHeight: lyricAreaHeight + lyricCenterPadding * 2,
                  },
                ]}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                onScrollBeginDrag={markUserScrolling}
                onScrollEndDrag={releaseUserScrolling}
                scrollEventThrottle={16}
                onScroll={(event) => {
                  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                  const distanceFromBottom =
                    contentSize.height - (contentOffset.y + layoutMeasurement.height);
                  const canAutoLoadMore =
                    userScrollingRef.current && Date.now() > autoScrollLockUntilRef.current;
                  if (contentOffset.y > 120) {
                    loadMoreAboveArmedRef.current = true;
                  }
                  if (distanceFromBottom > 120) {
                    loadMoreBelowArmedRef.current = true;
                  }
                  if (
                    canAutoLoadMore &&
                    loadMoreAboveArmedRef.current &&
                    contentOffset.y >= 0 &&
                    contentOffset.y < 32
                  ) {
                    loadMoreAboveArmedRef.current = false;
                    if (__DEV__) {
                      console.log("[TTSPage][lyrics] load-more-above", {
                        offsetY: contentOffset.y,
                      });
                    }
                    triggerLoadMoreAbove();
                  }
                  if (canAutoLoadMore && loadMoreBelowArmedRef.current && distanceFromBottom < 32) {
                    loadMoreBelowArmedRef.current = false;
                    if (__DEV__) {
                      console.log("[TTSPage][lyrics] load-more-below", {
                        distanceFromBottom,
                      });
                    }
                    triggerLoadMoreBelow();
                  }
                }}
              >
                <View style={s.lyricInner}>
                  {lyricSegments.map((item, index) => {
                    const active = index === safeChunkIndex;
                    const past = index < safeChunkIndex;
                    return (
                      <View
                        key={item.id}
                        onLayout={(event) => {
                          const { y, height } = event.nativeEvent.layout;
                          lyricLayoutRef.current.set(item.id, { y, height });
                          if (
                            visible &&
                            shouldAutoCenterLyrics &&
                            pendingCenterRef.current === index &&
                            !userScrollingRef.current
                          ) {
                            pendingCenterRef.current = null;
                            lastCenteredSignatureRef.current = `${index}:${currentSegmentCfi || ""}:${Math.round(lyricAreaHeight)}`;
                            requestAnimationFrame(() => {
                              if (!shouldAutoCenterLyrics) return;
                              centerLyricIndex(index, true);
                            });
                          }
                        }}
                      >
                        <Pressable
                          style={[s.lyricLinePressable, active && s.lyricLinePressableActive]}
                          onPress={() => handleLyricPress(item, index)}
                        >
                          <Text
                            style={[
                              s.lyricLine,
                              active && s.lyricLineActive,
                              past && s.lyricLinePast,
                            ]}
                          >
                            {item.text}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}

                  {continuousEnabled &&
                  playState === "playing" &&
                  safeChunkIndex >= lyricSegments.length - 1 ? (
                    <View style={s.lyricLoadingFooter}>
                      <ActivityIndicator size="small" color={colors.mutedForeground} />
                    </View>
                  ) : null}
                </View>
              </ScrollView>
            ) : (
              <Text style={s.lyricActive}>{currentExcerpt || t("tts.waitingText")}</Text>
            )}
          </View>

          <View style={{ paddingBottom: chromeBottomInset + 4 }}>
            {/* Мини-панель: пресеты скорости и стоп (play/пауза — в нативном плеере ниже) */}
            <View style={s.speedRow}>
              {TTS_SPEED_PRESETS.map((preset) => {
                const active = Math.abs(config.rate - preset) < 0.05;
                return (
                  <Pressable
                    key={preset}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={t("narra.ttsSpeedValue", "Скорость {{value}}×", {
                      value: preset,
                    })}
                    onPress={() => onUpdateConfig?.({ rate: preset })}
                    style={[s.speedChip, active && s.speedChipActive]}
                  >
                    <Text style={[s.speedChipTxt, active && s.speedChipTxtActive]}>
                      {`${preset}×`}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("narra.ttsStop", "Стоп")}
                onPress={() => {
                  onStop();
                  onClose();
                }}
                style={s.stopChip}
              >
                <Text style={s.stopChipTxt}>{t("narra.ttsStop", "Стоп")}</Text>
              </Pressable>
            </View>
            <TTSNativePlayer
              playState={playState}
              onPlayPause={onPlayPause}
              chapterCurrentIndex={chapterCurrentIndex}
              chapterTotalChunks={chapterTotalChunks}
              onSeekChapterChunk={onSeekChapterChunk}
            />
          </View>
        </View>
      </View>
    </TTSPageSheet>
  );
}
