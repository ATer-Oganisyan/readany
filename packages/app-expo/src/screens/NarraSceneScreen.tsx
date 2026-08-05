import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { EmptyStateActionButton } from "@/components/ui/empty-state-action-button";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import { NarraAudioPlayer } from "@/lib/narra/audio-player";
import { reportNarraError } from "@/lib/narra/errors";
import {
  generateSceneImage,
  normalizePersistedNarraMediaUri,
  synthesizeNarraSpeech,
} from "@/lib/narra/media";
import { generateNarraAudioScenario } from "@/lib/narra/scene-audio";
import type { NarraCharacter, NarraSceneAudioSegment } from "@/lib/narra/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useNarraStore } from "@/stores";
import { useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "NarraScene">;
const EMPTY_CHARACTERS: NarraCharacter[] = [];
type AudioStatus = "idle" | "preparing" | "playing";

function sceneChapterTitle(chapter: string): string {
  const title = chapter.replace(/^\s*\d{1,3}(?:[.)]|[—–-])?\s+(?=\D)/, "").trim();
  return title || chapter.trim();
}

export function NarraSceneScreen({ route, navigation }: Props) {
  const { bookId, chapter, excerpt, sourceKey } = route.params;
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const displayChapter = sceneChapterTitle(chapter);
  const characters = useNarraStore((state) => state.books[bookId]?.characters ?? EMPTY_CHARACTERS);
  const cachedScene = useNarraStore((state) => state.books[bookId]?.scenes?.[sourceKey]);
  const cachedAudio = useNarraStore((state) => state.books[bookId]?.sceneAudios?.[sourceKey]);
  const setScene = useNarraStore((state) => state.setScene);
  const setSceneAudio = useNarraStore((state) => state.setSceneAudio);
  const [imageUri, setImageUri] = useState(() =>
    cachedScene?.imageUri ? normalizePersistedNarraMediaUri(cachedScene.imageUri) : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("idle");
  const startedRef = useRef(false);
  const audioRef = useRef(new NarraAudioPlayer());
  const audioRunRef = useRef(0);
  const scrollY = useRef(new Animated.Value(0)).current;
  const imageStretchStyle = {
    transformOrigin: "top center" as const,
    transform: [
      {
        translateY: scrollY.interpolate({
          inputRange: [-viewportWidth, 0, viewportWidth],
          outputRange: [-viewportWidth, 0, 0],
          extrapolate: "clamp" as const,
        }),
      },
      {
        scale: scrollY.interpolate({
          inputRange: [-viewportWidth, 0],
          outputRange: [2, 1],
          extrapolate: "clamp" as const,
        }),
      },
    ],
  };

  const generate = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const nextImageUri = await generateSceneImage(bookId, chapter, excerpt, characters);
      setImageUri(nextImageUri);
      setScene(bookId, {
        sourceKey,
        chapter,
        excerpt,
        imageUri: nextImageUri,
        generatedAt: Date.now(),
      });
    } catch (cause) {
      setError(reportNarraError("scene_image", cause).message);
    } finally {
      setLoading(false);
    }
  }, [bookId, chapter, characters, excerpt, loading, setScene, sourceKey]);

  useEffect(() => {
    if (startedRef.current || imageUri) return;
    startedRef.current = true;
    void generate();
  }, [generate, imageUri]);

  useEffect(
    () => () => {
      audioRunRef.current += 1;
      audioRef.current.stop();
    },
    [],
  );

  const stopAudio = useCallback(() => {
    audioRunRef.current += 1;
    audioRef.current.stop();
    setAudioStatus("idle");
  }, []);

  const playUri = useCallback(
    (uri: string) =>
      new Promise<void>((resolve) => {
        audioRef.current.play(uri, resolve, resolve);
      }),
    [],
  );

  const playScene = useCallback(async () => {
    if (audioStatus !== "idle") {
      stopAudio();
      return;
    }

    const runId = audioRunRef.current + 1;
    audioRunRef.current = runId;
    setAudioStatus("preparing");

    try {
      const segments: NarraSceneAudioSegment[] = cachedAudio?.segments?.length
        ? cachedAudio.segments.map((segment) => ({ ...segment }))
        : await generateNarraAudioScenario(excerpt, characters);
      if (audioRunRef.current !== runId) return;

      const createdAt = cachedAudio?.createdAt ?? Date.now();
      setSceneAudio(bookId, { sourceKey, segments, createdAt });
      recordTelemetry("tts_playback_started", {
        source: "scene",
        cache_hit: Boolean(cachedAudio?.segments?.every((segment) => segment.audioUri)),
        origin: "user",
      });

      const ensureAudio = async (index: number): Promise<string> => {
        const segment = segments[index];
        if (!segment) throw new Error("Audio segment is missing");
        if (segment.audioUri) return normalizePersistedNarraMediaUri(segment.audioUri);
        const audioUri = await synthesizeNarraSpeech(segment.text, segment.voice);
        segments[index] = { ...segment, audioUri };
        setSceneAudio(bookId, {
          sourceKey,
          segments: segments.map((item) => ({ ...item })),
          createdAt,
        });
        return audioUri;
      };

      let prefetched: { index: number; promise: Promise<string> } | null = null;
      for (let index = 0; index < segments.length; index += 1) {
        if (audioRunRef.current !== runId) return;
        setAudioStatus("preparing");

        const uri =
          prefetched?.index === index ? await prefetched.promise : await ensureAudio(index);
        if (audioRunRef.current !== runId) return;

        const nextIndex = index + 1;
        prefetched =
          nextIndex < segments.length
            ? { index: nextIndex, promise: ensureAudio(nextIndex) }
            : null;
        prefetched?.promise.catch(() => undefined);

        setAudioStatus("playing");
        await playUri(uri);
      }
    } catch (cause) {
      if (audioRunRef.current === runId) {
        reportNarraError("scene_speech", cause);
      }
    } finally {
      if (audioRunRef.current === runId) {
        setAudioStatus("idle");
      }
    }
  }, [
    audioStatus,
    bookId,
    cachedAudio,
    characters,
    excerpt,
    playUri,
    setSceneAudio,
    sourceKey,
    stopAudio,
  ]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => null,
      headerTintColor: "#fff",
      headerTitleStyle: { color: "#fff" },
      statusBarStyle: "light",
      unstable_headerRightItems: () => [],
    });
  }, [navigation]);

  return (
    <Animated.ScrollView
      alwaysBounceVertical
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={styles.content}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
      })}
      scrollEventThrottle={16}
      style={{ backgroundColor: colors.background }}
    >
      {imageUri ? (
        <Animated.View style={[styles.imageWrap, imageStretchStyle]}>
          <Image
            accessibilityLabel={`Иллюстрация к главе ${displayChapter}`}
            source={{ uri: imageUri }}
            style={[styles.image, { backgroundColor: colors.card }]}
            onError={() => setImageUri(null)}
          />
          {loading ? (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          ) : null}
        </Animated.View>
      ) : loading ? (
        <CenteredEmptyState title="Создаём сцену" description="Это может занять немного времени">
          <ActivityIndicator size="small" color={colors.primary} />
        </CenteredEmptyState>
      ) : (
        <CenteredEmptyState
          title="Не удалось создать сцену"
          description={error || "Попробуйте снова"}
        >
          <EmptyStateActionButton
            label="Попробовать снова"
            disabled={loading}
            onPress={() => void generate()}
          />
        </CenteredEmptyState>
      )}

      {imageUri ? (
        <View style={styles.caption}>
          <Text style={[styles.chapter, { color: colors.foreground }]}>{displayChapter}</Text>
          <Text style={[styles.excerpt, { color: colors.mutedForeground }]}>{excerpt}</Text>
          {error ? <Text style={{ color: colors.mutedForeground }}>{error}</Text> : null}
          <View style={styles.audioControls}>
            <NativeButton
              accessibilityLabel={
                audioStatus === "preparing"
                  ? "Готовим озвучку"
                  : audioStatus === "idle"
                    ? "Озвучить сцену по ролям"
                    : "Остановить озвучку"
              }
              fullWidth
              icon={
                audioStatus === "preparing" ? undefined : audioStatus === "idle" ? "play" : "close"
              }
              label={audioStatus === "idle" ? "Озвучить по ролям" : "Остановить"}
              loading={audioStatus === "preparing"}
              onPress={() => void playScene()}
              variant={audioStatus === "playing" ? "secondary" : "primary"}
            />
          </View>
        </View>
      ) : null}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 32 },
  imageWrap: { position: "relative", width: "100%", aspectRatio: 1, overflow: "hidden" },
  image: { width: "100%", height: "100%" },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  caption: { paddingHorizontal: 20, paddingTop: 20, gap: 8 },
  chapter: { fontSize: 17, fontWeight: "700" },
  excerpt: { fontSize: 15, lineHeight: 22 },
  audioControls: { gap: 10, paddingTop: 16 },
});
