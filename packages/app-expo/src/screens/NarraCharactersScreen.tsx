import { AnimatedNarraFace } from "@/components/chat/animated-narra-face";
import {
  CharacterChatAvatar,
  CharacterChatList,
  type CharacterChatListItem,
} from "@/components/chats/character-chat-list";
import { CharacterPortraitImage } from "@/components/narra/character-portrait-image";
import { type ExtractorRef, ExtractorWebView } from "@/components/rag/ExtractorWebView";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import {
  openBackendBookSync,
  selectBackendManifestSource,
} from "@/lib/narra/backend-book-coordinator";
import { analyzeBookCharacters } from "@/lib/narra/character-analysis";
import { hasCharacterPortrait } from "@/lib/narra/character-portrait";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import { NarraServiceError, reportNarraError } from "@/lib/narra/errors";
import { ensureCharacterPortrait, normalizePersistedNarraMediaUri } from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
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
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "NarraCharacters">;
const SHADOW_PREVIEW_ENABLED = process.env.EXPO_PUBLIC_NARRA_SHADOW_PREVIEW === "1";

export function NarraCharactersScreen({ route, navigation }: Props) {
  const { bookId } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const book = useLibraryStore((state) => state.books.find((item) => item.id === bookId));
  const bookState = useNarraStore((state) => state.books[bookId]);
  const analyzing = useNarraStore((state) => state.analyzingBookId === bookId);
  const narraStoreHydrated = useNarraStore((state) => state._hasHydrated);
  const updateCharacter = useNarraStore((state) => state.updateCharacter);
  const extractorRef = useRef<ExtractorRef>(null);
  const analysisActiveRef = useRef(false);
  const portraitAttemptsRef = useRef(new Set<string>());
  const validatedPortraitsRef = useRef(new Set<string>());
  const validatedBookIdRef = useRef(bookId);
  const autoAnalysisStartedRef = useRef(false);
  const [analysisStage, setAnalysisStage] = useState("");
  const [portraitLoading, setPortraitLoading] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const storedCharacters = bookState?.characters ?? [];
  const characters = storedCharacters;
  const visibleCharacters = useMemo(
    () => characters.filter((character) => isCharacterUnlocked(book?.progress ?? 0, character)),
    [book?.progress, characters],
  );
  const busy = analyzing || Boolean(analysisStage);
  const manifestSource = bookState?.backendManifestSource ?? "v2";
  const canPreviewShadow =
    SHADOW_PREVIEW_ENABLED && bookState?.backendBinding?.resolution === "catalog";

  useEffect(() => {
    recordTelemetry("character_opened", { feature: "character" });
  }, []);

  useEffect(() => {
    if (!narraStoreHydrated || !book) return;
    void openBackendBookSync(book);
  }, [book, narraStoreHydrated]);

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
      characters.length > 0 ||
      bookState?.backendBinding ||
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
    bookState?.backendBinding,
    characters.length,
    narraStoreHydrated,
  ]);

  useEffect(() => {
    if (!book || busy || portraitLoading) return;
    const nextCharacter = characters.find(
      (character) =>
        isCharacterUnlocked(book.progress, character) &&
        character.mediaSource !== "backend" &&
        !hasCharacterPortrait(character) &&
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

  const openCharacterChat = useCallback(
    (character: NarraCharacter) => {
      navigation.navigate("NarraCharacterChat", {
        bookId,
        characterId: character.id,
      });
    },
    [bookId, navigation],
  );

  const toggleManifestSource = useCallback(async () => {
    if (!book || previewLoading) return;
    const nextSource = manifestSource === "shadow-v3" ? "v2" : "shadow-v3";
    setPreviewLoading(true);
    try {
      await selectBackendManifestSource(book, nextSource);
    } catch (error) {
      Alert.alert(
        t("narra.shadowPreviewFailed", "Не удалось открыть тестовую разметку"),
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [book, manifestSource, previewLoading, t]);

  const listItems: CharacterChatListItem[] = [
    {
      key: "narra",
      accessibilityLabel: t("narra.openNarraBookChat", "Открыть чат с Наррой об этой книге"),
      title: "Нарра",
      subtitle: t("narra.askAboutBook", "Спросите что угодно о книге"),
      onPress: () => navigation.navigate("BookChat", { bookId }),
      avatar: (
        <CharacterChatAvatar muted>
          <AnimatedNarraFace width={38} height={40} />
        </CharacterChatAvatar>
      ),
    },
    ...visibleCharacters.map((character): CharacterChatListItem => {
      const portraitBusy = portraitLoading === character.id;

      return {
        key: character.id,
        accessibilityLabel: t("narra.openCharacterChat", "Открыть чат с {{character}}", {
          character: character.name,
        }),
        title: character.fullName || character.name,
        subtitle: character.role,
        onPress: () => openCharacterChat(character),
        avatar: (
          <CharacterChatAvatar
            overlay={
              portraitBusy && hasCharacterPortrait(character) ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : undefined
            }
          >
            <CharacterPortraitImage
              character={character}
              style={styles.avatarImage}
              fallback={
                <InitialsAvatar
                  size={56}
                  userId={`${bookId}:${character.id}`}
                  name={character.fullName || character.name}
                />
              }
            />
          </CharacterChatAvatar>
        ),
      };
    }),
  ];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      style={styles.container}
    >
      <ExtractorWebView ref={extractorRef} />
      {canPreviewShadow ? (
        <View style={styles.previewPanel}>
          <View style={styles.previewCopy}>
            <Text style={styles.previewTitle}>
              {manifestSource === "shadow-v3" ? "Тестовая разметка v3" : "Рабочая разметка v2"}
            </Text>
            <Text style={styles.previewDescription}>
              {manifestSource === "shadow-v3"
                ? "Показан результат полного shadow-анализа"
                : "Можно сравнить с новым полным анализом книги"}
            </Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={manifestSource === "shadow-v3" ? "Показать v2" : "Показать v3"}
            activeOpacity={0.82}
            disabled={previewLoading}
            onPress={() => void toggleManifestSource()}
            style={[styles.previewButton, previewLoading && styles.disabled]}
          >
            {previewLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.previewButtonText}>
                {manifestSource === "shadow-v3" ? "Показать v2" : "Показать v3"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
      <CharacterChatList items={listItems} />
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
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: {
      flexGrow: 1,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl,
    },
    emptyActions: { alignItems: "center", gap: spacing.md },
    previewPanel: {
      marginBottom: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.card,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    previewCopy: { flex: 1, gap: spacing.xs },
    previewTitle: { color: colors.foreground, fontWeight: fontWeight.semibold },
    previewDescription: { color: colors.mutedForeground, fontSize: fontSize.xs },
    previewButton: {
      minHeight: 36,
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      borderRadius: radius.full,
      backgroundColor: colors.accent,
    },
    previewButtonText: {
      color: colors.primary,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
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
    avatarImage: { width: "100%", height: "100%" },
  });
