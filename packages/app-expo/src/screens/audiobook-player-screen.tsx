import { SystemSheetZoomDestination } from "@/components/navigation/SystemSheetZoomDestination";
// Presentation adapted from expo-ui-examples/mini-player/player-screen.tsx.
// MIT attribution: vendor/expo-ui-examples-LICENSE.txt.
import { useTTSNativePlayer } from "@/components/reader/tts/useTTSNativePlayer";
import { AudiobookPlayerContent } from "@/components/tts/audiobook-player-content";
import { AudiobookPlayerSheet } from "@/components/tts/audiobook-player-sheet";
import { useAudiobookArtwork } from "@/components/tts/use-audiobook-artwork";
import { useCoverSheetColors } from "@/hooks/use-cover-sheet-colors";
import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { findNarrationChapter } from "@/lib/tts-chapter-progress";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores/library-store";
import { useTTSStore } from "@/stores/tts-store";
import { useColors } from "@/styles/theme";
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
  const [volume, setVolume] = useState(1);
  const state = useTTSStore(
    useShallow((s) => ({
      playState: s.playState,
      title: s.currentBookTitle,
      artwork: s.currentArtwork,
      chapter: s.currentChapterTitle,
      bookId: s.currentBookId,
      cfi: s.currentLocationCfi,
      currentChunkIndex: s.currentChunkIndex,
      segmentCfis: s.segmentCfis,
      chapters: s.narrationChapters,
      seekChapterSegment: s.seekChapterSegment,
      skipSentence: s.skipSentence,
      toggle: s.toggle,
      stop: s.stop,
    })),
  );
  const artwork = useAudiobookArtwork();
  const coverColor = useCoverSheetColors(artwork);
  const backgroundColor = coverColor?.color ?? colors.background;
  useLayoutEffect(() => {
    if (Platform.OS === "android") return;
    navigation.setOptions({
      contentStyle: { backgroundColor },
    });
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
    <AudiobookPlayerSheet backgroundColor={backgroundColor} onDismiss={() => navigation.goBack()}>
      <View collapsable={false}>
        <SystemSheetZoomDestination sourceId={route.params?.sourceId} expanded={false} />
        <AudiobookPlayerContent
          backgroundColor={backgroundColor}
          accentColor={coverColor?.accent}
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
        />
      </View>
    </AudiobookPlayerSheet>
  );
}
