import { useAudiobookArtwork } from "@/components/tts/use-audiobook-artwork";
import ReadAnyNativeControls from "../../modules/native-controls";
import { useColors } from "@/styles/theme";
import { SystemSheetZoomDestination } from "@/components/navigation/SystemSheetZoomDestination";
// Presentation adapted from expo-ui-examples/mini-player/player-screen.tsx.
// MIT attribution: vendor/expo-ui-examples-LICENSE.txt.
import { useTTSNativePlayer } from "@/components/reader/tts/useTTSNativePlayer";
import { TTSSleepTimerSheet } from "@/components/tts/TTSSleepTimerSheet";
import { AudiobookPlayerContent } from "@/components/tts/audiobook-player-content";
import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { findNarrationChapter } from "@/lib/tts-chapter-progress";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores/library-store";
import { useTTSStore } from "@/stores/tts-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import TrackPlayer from "react-native-track-player";
import { useShallow } from "zustand/react/shallow";

export function AudiobookPlayerScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, "AudiobookPlayer">) {
  const colors = useColors();
  const [coverColor, setCoverColor] = useState<{ uri: string; color: string; accent: string }>();
  const [timerVisible, setTimerVisible] = useState(false);
  const [volume, setVolume] = useState(1);
  const state = useTTSStore(
    useShallow((s) => ({
      playState: s.playState,
      title: s.currentBookTitle,
      artwork: s.currentArtwork,
      chapter: s.currentChapterTitle,
      bookId: s.currentBookId,
      cfi: s.currentLocationCfi,
      rate: s.config.rate,
      sleepTimerEndsAt: s.sleepTimerEndsAt,
      currentChunkIndex: s.currentChunkIndex,
      segmentCfis: s.segmentCfis,
      chapters: s.narrationChapters,
      seekChapterSegment: s.seekChapterSegment,
      skipSentence: s.skipSentence,
      toggle: s.toggle,
      updateConfig: s.updateConfig,
      stop: s.stop,
      setSleepTimer: s.setSleepTimer,
      clearSleepTimer: s.clearSleepTimer,
    })),
  );
  const artwork = useAudiobookArtwork();
  const backgroundColor = coverColor?.uri === artwork ? coverColor.color : colors.background;
  useEffect(() => {
    if (Platform.OS !== "ios" || !artwork || !ReadAnyNativeControls.averageTopImageColor) {
      return;
    }
    let cancelled = false;
    void ReadAnyNativeControls.averageTopImageColor(artwork, 0.25)
      .then((color) => {
        if (cancelled || !/^#[0-9a-f]{6}$/i.test(color)) return;
        // Mix in 35% black for a deeper background that preserves the cover hue.
        const darker =
          "#" +
          [1, 3, 5]
            .map((offset) =>
              Math.round(parseInt(color.slice(offset, offset + 2), 16) * 0.65)
                .toString(16)
                .padStart(2, "0"),
            )
            .join("");
        // Screen with 60% white over the sheet background, precomputed for native tint.
        const accent =
          "#" +
          [1, 3, 5]
            .map((offset) =>
              Math.round(parseInt(darker.slice(offset, offset + 2), 16) * 0.4 + 255 * 0.6)
                .toString(16)
                .padStart(2, "0"),
            )
            .join("");
        setCoverColor({ uri: artwork, color: darker, accent });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [artwork]);
  useLayoutEffect(() => {
    if (Platform.OS === "ios") {
      navigation.setOptions({
        contentStyle: { backgroundColor },
      });
    }
  }, [backgroundColor, navigation]);
  const bookAuthor = useLibraryStore(
    (s) => s.books.find((book) => book.id === state.bookId)?.meta.author,
  );
  const author = bookAuthor || findBundledCatalogBookByTitle(state.title)?.author || "";
  const chapter = useMemo(
    () =>
      findNarrationChapter(state.chapters, state.segmentCfis[state.currentChunkIndex] ?? state.cfi),
    [state.chapters, state.segmentCfis, state.currentChunkIndex, state.cfi],
  );
  const player = useTTSNativePlayer(state.playState, state.toggle, {
    chapterProgressOnly: true,
    chapterCurrentIndex: chapter?.index,
    chapterTotalChunks: chapter?.chapter.segments.length,
    onSeekChapterChunk: chapter
      ? (index) => state.seekChapterSegment(chapter.chapter.id, index)
      : undefined,
  });
  useEffect(() => {
    let cancelled = false;
    void TrackPlayer.getVolume()
      .then((value) => {
        if (!cancelled) setVolume(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View collapsable={false} style={Platform.OS === "ios" ? undefined : { flex: 1 }}>
      <SystemSheetZoomDestination sourceId={route.params?.sourceId} expanded={false} />
      <AudiobookPlayerContent
        backgroundColor={Platform.OS === "ios" ? backgroundColor : undefined}
        accentColor={coverColor?.uri === artwork ? coverColor.accent : undefined}
        title={state.title}
        author={author}
        chapter={chapter?.chapter.title || state.chapter}
        volume={volume}
        onVolumeChange={(value) => {
          setVolume(value);
          void TrackPlayer.setVolume(value).catch((error) =>
            console.warn("[Audiobook] Volume change failed", error),
          );
        }}
        rate={state.rate}
        timerActive={Boolean(state.sleepTimerEndsAt)}
        player={player}
        onPreviousSentence={() => state.skipSentence(-1)}
        onNextSentence={() => state.skipSentence(1)}
        canGoToPreviousSentence={Boolean(chapter && chapter.index > 0)}
        canGoToNextSentence={Boolean(
          chapter && chapter.index < chapter.chapter.segments.length - 1,
        )}
        onStop={() => {
          state.stop();
          navigation.goBack();
        }}
        onRead={() =>
          navigation.popTo("Reader", {
            bookId: state.bookId,
            cfi: state.cfi || undefined,
            openTTS: true,
          })
        }
        onRateChange={(rate) => state.updateConfig({ rate })}
        onSetTimer={state.setSleepTimer}
        onClearTimer={state.clearSleepTimer}
        onCustomTimer={() => setTimerVisible(true)}
      />
      <TTSSleepTimerSheet visible={timerVisible} onClose={() => setTimerVisible(false)} />
    </View>
  );
}
