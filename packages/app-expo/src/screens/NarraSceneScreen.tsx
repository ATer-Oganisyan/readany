import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { EmptyStateActionButton } from "@/components/ui/empty-state-action-button";
import { reportNarraError } from "@/lib/narra/errors";
import { generateSceneImage } from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useNarraStore } from "@/stores";
import { useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "NarraScene">;
const EMPTY_CHARACTERS: NarraCharacter[] = [];

export function NarraSceneScreen({ route, navigation }: Props) {
  const { bookId, chapter, excerpt, sourceKey } = route.params;
  const colors = useColors();
  const characters = useNarraStore((state) => state.books[bookId]?.characters ?? EMPTY_CHARACTERS);
  const cachedScene = useNarraStore((state) => state.books[bookId]?.scenes?.[sourceKey]);
  const setScene = useNarraStore((state) => state.setScene);
  const [imageUri, setImageUri] = useState(cachedScene?.imageUri ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

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
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={styles.content}
      style={{ backgroundColor: colors.background }}
    >
      {imageUri ? (
        <View style={styles.imageWrap}>
          <Image
            accessibilityLabel={`Иллюстрация к главе ${chapter}`}
            source={{ uri: imageUri }}
            style={[styles.image, { backgroundColor: colors.card }]}
          />
          {loading ? (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          ) : null}
        </View>
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
          <Text style={[styles.chapter, { color: colors.foreground }]}>{chapter}</Text>
          <Text style={[styles.excerpt, { color: colors.mutedForeground }]}>{excerpt}</Text>
          {error ? <Text style={{ color: colors.mutedForeground }}>{error}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 32 },
  imageWrap: { position: "relative", width: "100%", aspectRatio: 1 },
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
});
