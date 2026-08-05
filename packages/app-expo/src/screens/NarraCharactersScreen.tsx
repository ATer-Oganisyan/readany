import { type ExtractorRef, ExtractorWebView } from "@/components/rag/ExtractorWebView";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import { getBundledCatalogCharactersByTitle } from "@/lib/narra/bundled-catalog-characters";
import { analyzeBookCharacters } from "@/lib/narra/character-analysis";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import { NarraServiceError, reportNarraError } from "@/lib/narra/errors";
import { ensureCharacterPortrait, normalizePersistedNarraMediaUri } from "@/lib/narra/media";
import { inspectMobileBookForVectorize } from "@/lib/rag/auto-vectorize-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore, useNarraStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useTheme } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import NarraFace from "../../assets/narra-face.svg";

type Props = NativeStackScreenProps<RootStackParamList, "NarraCharacters">;

export function NarraCharactersScreen({ route, navigation }: Props) {
  const { bookId } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const book = useLibraryStore((state) => state.books.find((item) => item.id === bookId));
  const bookState = useNarraStore((state) => state.books[bookId]);
  const analyzing = useNarraStore((state) => state.analyzingBookId === bookId);
  const narraStoreHydrated = useNarraStore((state) => state._hasHydrated);
  const setCharacters = useNarraStore((state) => state.setCharacters);
  const updateCharacter = useNarraStore((state) => state.updateCharacter);
  const extractorRef = useRef<ExtractorRef>(null);
  const analysisActiveRef = useRef(false);
  const portraitAttemptsRef = useRef(new Set<string>());
  const validatedPortraitsRef = useRef(new Set<string>());
  const validatedBookIdRef = useRef(bookId);
  const autoAnalysisStartedRef = useRef(false);
  const [analysisStage, setAnalysisStage] = useState("");
  const [portraitLoading, setPortraitLoading] = useState<string | null>(null);
  const storedCharacters = bookState?.characters ?? [];
  const bundledCharacters = useMemo(
    () => (book ? getBundledCatalogCharactersByTitle(book.meta.title) : undefined),
    [book],
  );
  const characters = storedCharacters.length > 0 ? storedCharacters : (bundledCharacters ?? []);
  const visibleCharacters = useMemo(
    () => characters.filter((character) => isCharacterUnlocked(book?.progress ?? 0, character)),
    [book?.progress, characters],
  );
  const busy = analyzing || Boolean(analysisStage);

  useEffect(() => {
    recordTelemetry("character_opened", { feature: "character" });
  }, []);

  useEffect(() => {
    if (!narraStoreHydrated || !book || storedCharacters.length > 0 || !bundledCharacters?.length) {
      return;
    }
    setCharacters(bookId, bundledCharacters);
  }, [book, bookId, bundledCharacters, narraStoreHydrated, setCharacters, storedCharacters.length]);

  useEffect(() => {
    let cancelled = false;
    if (validatedBookIdRef.current !== bookId) {
      validatedBookIdRef.current = bookId;
      validatedPortraitsRef.current.clear();
      autoAnalysisStartedRef.current = false;
    }
    for (const character of characters) {
      const persistedUri = character.portraitUri;
      if (!persistedUri?.startsWith("file://")) continue;
      const normalizedUri = normalizePersistedNarraMediaUri(persistedUri);
      const validationKey = `${character.id}:${normalizedUri}`;
      if (validatedPortraitsRef.current.has(validationKey)) continue;
      validatedPortraitsRef.current.add(validationKey);
      void FileSystem.getInfoAsync(normalizedUri).then((info) => {
        if (cancelled) return;
        if (!info.exists) {
          updateCharacter(bookId, character.id, { portraitUri: undefined });
        } else if (normalizedUri !== persistedUri) {
          updateCharacter(bookId, character.id, { portraitUri: normalizedUri });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [bookId, characters, updateCharacter]);

  const analyze = useCallback(
    async (interactive = true) => {
      if (!book || analysisActiveRef.current) return;
      analysisActiveRef.current = true;
      portraitAttemptsRef.current.clear();
      try {
        if (__DEV__ && process.env.EXPO_PUBLIC_NARRA_USE_MOCKS === "1") {
          setAnalysisStage(t("narra.analyzing", "Ищу героев…"));
          await analyzeBookCharacters(book);
          return;
        }
        setAnalysisStage(t("narra.analyzing", "Ищу героев…"));
        await analyzeBookCharacters(book, async () => {
          setAnalysisStage(t("narra.extracting", "Извлекаю текст…"));
          const info = await inspectMobileBookForVectorize(book);
          if (!info.canVectorize || !info.mimeType || !extractorRef.current) return "";

          let text: string;
          try {
            text = await extractorRef.current.extractTextSample({
              uri: info.absPath,
              mimeType: info.mimeType,
              maxChars: 48_000,
            });
            if (!text.trim()) {
              throw new Error("Book text sample is empty");
            }
          } catch (sampleError) {
            if (!info.size || info.size > 12 * 1024 * 1024) throw sampleError;
            console.warn("[Narra] URI text sampling failed, retrying with base64", sampleError);
            const base64 = await FileSystem.readAsStringAsync(info.absPath, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const chapters = await extractorRef.current.extractChapters(base64, info.mimeType);
            text = chapters
              .map((chapter) => `${chapter.title || ""}\n${chapter.content || ""}`.trim())
              .filter(Boolean)
              .join("\n\n");
          }
          setAnalysisStage(t("narra.analyzing", "Ищу героев…"));
          return text;
        });
      } catch (error) {
        const normalized = reportNarraError("character_analysis_ui", error);
        if (interactive) {
          const detail =
            error instanceof NarraServiceError && error.technicalDetail
              ? error.technicalDetail
              : error instanceof Error
                ? error.message
                : String(error);
          Alert.alert(
            t("narra.analysisFailedTitle", "Не удалось найти персонажей"),
            __DEV__ && detail !== normalized.message
              ? `${normalized.message}\n\nДиагностика: ${detail}`
              : normalized.message,
          );
        }
      } finally {
        analysisActiveRef.current = false;
        setAnalysisStage("");
      }
    },
    [book, t],
  );

  useEffect(() => {
    if (
      !narraStoreHydrated ||
      !book ||
      Boolean(bundledCharacters?.length) ||
      characters.length > 0 ||
      bookState?.analyzedAt ||
      bookState?.analysisError ||
      autoAnalysisStartedRef.current
    ) {
      return;
    }

    autoAnalysisStartedRef.current = true;
    void analyze(false);
  }, [
    analyze,
    book,
    bookState?.analysisError,
    bookState?.analyzedAt,
    bundledCharacters?.length,
    characters.length,
    narraStoreHydrated,
  ]);

  useEffect(() => {
    if (!book || busy || portraitLoading) return;
    const nextCharacter = characters.find(
      (character) =>
        isCharacterUnlocked(book.progress, character) &&
        !character.portraitUri &&
        !portraitAttemptsRef.current.has(character.id),
    );
    if (!nextCharacter) return;

    portraitAttemptsRef.current.add(nextCharacter.id);
    setPortraitLoading(nextCharacter.id);
    void ensureCharacterPortrait(bookId, nextCharacter)
      .then((portraitUri) => updateCharacter(bookId, nextCharacter.id, { portraitUri }))
      .catch((error) => reportNarraError("character_portrait_background", error))
      .finally(() => setPortraitLoading(null));
  }, [book, bookId, busy, characters, portraitLoading, updateCharacter]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      style={styles.container}
    >
      <ExtractorWebView ref={extractorRef} />
      <View style={styles.list}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Открыть чат с Наррой о книге"
          activeOpacity={0.62}
          onPress={() => navigation.navigate("BookChat", { bookId })}
          style={styles.characterRow}
        >
          <View style={[styles.avatar, styles.narraAvatar]}>
            <NarraFace width={38} height={40} />
          </View>
          <View style={styles.characterCopy}>
            <Text style={styles.characterName} numberOfLines={1}>
              Нарра
            </Text>
            <Text style={styles.characterDescription} numberOfLines={1}>
              Спросите что угодно о книге
            </Text>
          </View>
        </TouchableOpacity>
        {visibleCharacters.length > 0 ? <View style={styles.separator} /> : null}
        {visibleCharacters.map((character, index) => {
          const portraitBusy = portraitLoading === character.id;
          return (
            <View key={character.id}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t("narra.openCharacterChat", "Открыть чат с {{character}}", {
                  character: character.name,
                })}
                activeOpacity={0.62}
                onPress={() =>
                  navigation.navigate("NarraCharacterChat", {
                    bookId,
                    characterId: character.id,
                  })
                }
                style={styles.characterRow}
              >
                <View style={styles.avatar}>
                  {character.portraitUri ? (
                    <Image
                      source={{ uri: normalizePersistedNarraMediaUri(character.portraitUri) }}
                      style={styles.avatarImage}
                      onError={() =>
                        updateCharacter(bookId, character.id, { portraitUri: undefined })
                      }
                    />
                  ) : portraitBusy ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={styles.avatarLetter}>
                      {character.name.slice(0, 1).toUpperCase()}
                    </Text>
                  )}
                </View>
                <View style={styles.characterCopy}>
                  <Text style={styles.characterName} numberOfLines={1}>
                    {character.fullName}
                  </Text>
                  <Text style={styles.characterDescription} numberOfLines={1}>
                    {character.role}
                  </Text>
                  {character.traits.length > 0 ? (
                    <Text style={styles.characterDescription} numberOfLines={1}>
                      {character.traits.join(", ")}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
              {index < visibleCharacters.length - 1 ? <View style={styles.separator} /> : null}
            </View>
          );
        })}
      </View>
      {characters.length === 0 ? (
        <CenteredEmptyState
          title={t("narra.meetCharacters", "Персонажей пока нет")}
          description={t("narra.analysisDescription", "Найдём их в тексте книги")}
        >
          <View style={styles.emptyActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={busy ? analysisStage : t("narra.findCharacters", "Найти героев")}
              activeOpacity={0.82}
              disabled={busy || !book}
              onPress={() => void analyze()}
              style={[styles.primaryButton, (busy || !book) && styles.disabled]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {t("narra.findCharacters", "Найти героев")}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </CenteredEmptyState>
      ) : visibleCharacters.length === 0 ? (
        <CenteredEmptyState
          title={t("narra.noUnlockedCharacters", "Персонажей пока нет")}
          description={t(
            "narra.keepReadingForCharacters",
            "Нашли героев: {{count}}. Они появятся здесь по мере чтения",
            { count: characters.length },
          )}
        >
          <View style={styles.emptyActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t("narra.reanalyzeCharacters", "Найти заново")}
              activeOpacity={0.82}
              disabled={busy || !book}
              onPress={() => void analyze(true)}
              style={[styles.primaryButton, (busy || !book) && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>
                {t("narra.reanalyzeCharacters", "Найти заново")}
              </Text>
            </TouchableOpacity>
          </View>
        </CenteredEmptyState>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, padding: spacing.lg },
    emptyActions: { alignItems: "center", gap: spacing.md },
    primaryButton: {
      minHeight: 46,
      paddingHorizontal: spacing.xl,
      borderRadius: radius.full,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.primary,
    },
    primaryButtonText: {
      color: colors.primaryForeground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    disabled: { opacity: 0.5 },
    list: {},
    characterRow: {
      minHeight: 80,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
      paddingVertical: spacing.md,
    },
    avatar: {
      width: 56,
      height: 56,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    avatarImage: { width: "100%", height: "100%" },
    narraAvatar: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.elevation2,
    },
    avatarLetter: {
      color: colors.primaryForeground,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
    },
    characterCopy: { flex: 1, gap: 2 },
    characterName: {
      color: colors.foreground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    characterDescription: {
      color: colors.mutedForeground,
      fontSize: fontSize.base,
      lineHeight: 20,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: 56 + spacing.lg,
      backgroundColor: colors.border,
    },
  });
