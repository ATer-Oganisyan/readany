import { SystemSheetZoomDestination } from "@/components/navigation/SystemSheetZoomDestination";
// Presentation adapted from expo-ui-examples/mini-player/player-screen.tsx.
// MIT attribution: vendor/expo-ui-examples-LICENSE.txt.
import { useTTSNativePlayer } from "@/components/reader/tts/useTTSNativePlayer";
import { AudiobookPlayerContent } from "@/components/tts/audiobook-player-content";
import { AudiobookPlayerSheet } from "@/components/tts/audiobook-player-sheet";
import { useAudiobookArtwork } from "@/components/tts/use-audiobook-artwork";
import { NativeSheetNavigationBar } from "@/components/ui/NativeSheetNavigationBar";
import { useCoverSheetColors } from "@/hooks/use-cover-sheet-colors";
import { findBundledCatalogBookByTitle } from "@/lib/catalog/bundled-books";
import { changeNarratorVoice, useNarratorVoicePreference } from "@/lib/narra/narrator-voice";
import { findNarrationChapter } from "@/lib/tts-chapter-progress";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores/library-store";
import { useTTSStore } from "@/stores/tts-store";
import { foregroundForBackground } from "@/styles/foreground-for-background";
import { useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet, View } from "react-native";
import TrackPlayer from "react-native-track-player";
import { useShallow } from "zustand/react/shallow";

// Same values as the reader's speed presets (TTSPage), named for the player menu.
const READING_SPEEDS = [
  { rate: 1, labelKey: "tts.speedNormal" },
  { rate: 1.25, labelKey: "tts.speedFast" },
  { rate: 1.5, labelKey: "tts.speedVeryFast" },
] as const;

const NARRATOR_VOICES = [
  { preference: "male", labelKey: "tts.narratorMale" },
  { preference: "female", labelKey: "tts.narratorFemale" },
] as const;

export function AudiobookPlayerScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, "AudiobookPlayer">) {
  const colors = useColors();
  const { t } = useTranslation();
  const narrator = useNarratorVoicePreference();
  const rate = useTTSStore((s) => s.config.rate);
  const updateConfig = useTTSStore((s) => s.updateConfig);
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
      totalChunks: s.totalChunks,
      segmentCfis: s.segmentCfis,
      chapters: s.narrationChapters,
      seekChapterSegment: s.seekChapterSegment,
      skipSentence: s.skipSentence,
      jumpToChunk: s.jumpToChunk,
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
  // Keep seeking within the loaded queue when this EPUB cannot map its sentence CFIs to a chapter.
  const currentIndex = chapter?.index ?? state.currentChunkIndex;
  const totalChunks = chapter?.chapter.segments.length ?? state.totalChunks;
  const skipSentence = (direction: -1 | 1) =>
    chapter ? state.skipSentence(direction) : state.jumpToChunk(currentIndex + direction);
  const player = useTTSNativePlayer(state.playState, state.toggle, {
    chapterProgressOnly: true,
    chapterCurrentIndex: currentIndex,
    chapterTotalChunks: totalChunks,
    onSeekChapterChunk: chapter
      ? (index) => state.seekChapterSegment(chapter.chapter.id, index)
      : state.jumpToChunk,
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
        {/* Laid over the player, so it changes neither the sheet height nor the zoom. */}
        <NativeSheetNavigationBar
          isDark={foregroundForBackground(backgroundColor).isDark}
          transparentBackground
          showsCloseButton={false}
          menuAccessibilityLabel={t("tts.playerMore")}
          menuSections={[
            {
              title: t("tts.narratorVoice"),
              items: NARRATOR_VOICES.map((voice) => ({
                key: `voice:${voice.preference}`,
                label: t(voice.labelKey),
                checked: narrator === voice.preference,
              })),
            },
            {
              title: t("tts.readingSpeed"),
              items: READING_SPEEDS.map((speed) => ({
                key: `rate:${speed.rate}`,
                label: t(speed.labelKey),
                checked: Math.abs(rate - speed.rate) < 0.05,
              })),
            },
          ]}
          onMenuItemPress={(key) => {
            const voice = NARRATOR_VOICES.find((item) => key === `voice:${item.preference}`);
            if (voice) changeNarratorVoice(voice.preference);
            const speed = READING_SPEEDS.find((item) => key === `rate:${item.rate}`);
            if (speed) updateConfig({ rate: speed.rate });
          }}
          style={styles.navigationBar}
        />
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
          onPreviousSentence={() => skipSentence(-1)}
          onNextSentence={() => skipSentence(1)}
          canGoToPreviousSentence={currentIndex > 0}
          canGoToNextSentence={currentIndex < totalChunks - 1}
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

const styles = StyleSheet.create({
  // Puts the button 16pt from both the top and the right edge of the sheet
  // (measured: the bar's own trailing margin leaves 14.5pt at right: 0).
  navigationBar: {
    position: "absolute",
    top: 17,
    left: 0,
    right: 1.5,
    height: 44,
    zIndex: 10,
  },
});
