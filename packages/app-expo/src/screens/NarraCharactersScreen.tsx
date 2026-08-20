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
import type { BackendManifestAnalysis } from "@/lib/narra/backend-book-api";
import { projectBackendManifestCharacters } from "@/lib/narra/backend-book-cache";
import {
  openBackendBookSync,
  shouldRefreshBackendManifest,
  supportsBackendBookMarkup,
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
  const backendRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [analysisStage, setAnalysisStage] = useState("");
  const [backendProcessing, setBackendProcessing] = useState(false);
  const [backendAnalysis, setBackendAnalysis] = useState<BackendManifestAnalysis | undefined>();
  const [provisionalCharacters, setProvisionalCharacters] = useState<NarraCharacter[]>([]);
  const [portraitLoading, setPortraitLoading] = useState<string | null>(null);
  const storedCharacters = bookState?.characters ?? [];
  const characters = storedCharacters.length > 0 ? storedCharacters : provisionalCharacters;
  const backendManagedBook = Boolean(book && supportsBackendBookMarkup(book.format));
  const visibleCharacters = useMemo(
    () => characters.filter((character) => isCharacterUnlocked(book?.progress ?? 0, character)),
    [book?.progress, characters],
  );
  const busy = analyzing || Boolean(analysisStage);

  useEffect(() => {
    recordTelemetry("character_opened", { feature: "character" });
  }, []);

  const backendBookRef = useRef(book);
  backendBookRef.current = book;
  const backendBookSyncKey = book
    ? `${book.id}\u0000${book.filePath}\u0000${book.fileHash ?? ""}`
    : "";
  useEffect(() => {
    if (!narraStoreHydrated || !backendBookSyncKey) return;
    let cancelled = false;

    const refresh = async () => {
      const currentBook = backendBookRef.current;
      if (!currentBook) return;
      const manifest = await openBackendBookSync(currentBook);
      if (cancelled) return;
      const processing = manifest?.availability === "processing";
      setBackendProcessing(processing);
      setBackendAnalysis(processing ? manifest?.analysis : undefined);
      setProvisionalCharacters(
        processing && manifest ? projectBackendManifestCharacters(manifest) : [],
      );
      if (shouldRefreshBackendManifest(manifest, currentBook.progress)) {
        backendRefreshTimerRef.current = setTimeout(refresh, 5_000);
      }
    };

    if (backendManagedBook && storedCharacters.length === 0) setBackendProcessing(true);
    void refresh();
    return () => {
      cancelled = true;
      if (backendRefreshTimerRef.current) clearTimeout(backendRefreshTimerRef.current);
      backendRefreshTimerRef.current = null;
    };
  }, [backendBookSyncKey, backendManagedBook, narraStoreHydrated, storedCharacters.length]);

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
      backendManagedBook ||
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
    backendManagedBook,
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
      if (character.analysisState === "provisional") return;
      navigation.navigate("NarraCharacterChat", {
        bookId,
        characterId: character.id,
      });
    },
    [bookId, navigation],
  );

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
      const provisional = character.analysisState === "provisional";
      const portraitBusy = portraitLoading === character.id;

      return {
        key: character.id,
        accessibilityLabel: provisional
          ? t("narra.characterProfilePreparing", "Профиль {{character}} формируется", {
              character: character.name,
            })
          : t("narra.openCharacterChat", "Открыть чат с {{character}}", {
              character: character.name,
            }),
        title: character.fullName || character.name,
        subtitle: provisional
          ? t("narra.profilePreparing", "Профиль формируется…")
          : character.role,
        disabled: provisional,
        onPress: () => openCharacterChat(character),
        avatar: (
          <CharacterChatAvatar
            muted={provisional}
            overlay={
              provisional || (portraitBusy && hasCharacterPortrait(character)) ? (
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
      <CharacterChatList items={listItems} />
      {backendProcessing && provisionalCharacters.length > 0 ? (
        <View style={styles.backendProgress}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.backendProgressText}>
            {backendAnalysis?.totalScanChunks
              ? t(
                  "narra.backendMarkupProgress",
                  "Продолжаю разметку: {{completed}} из {{total}} фрагментов",
                  {
                    completed: backendAnalysis.completedScanChunks,
                    total: backendAnalysis.totalScanChunks,
                  },
                )
              : t("narra.backendMarkupContinuing", "Продолжаю разметку книги…")}
          </Text>
        </View>
      ) : null}
      {characters.length === 0 && backendManagedBook ? (
        <CenteredEmptyState
          title={
            backendProcessing
              ? t("narra.backendMarkupProcessingTitle", "Размечаю книгу…")
              : t("narra.backendCharactersAheadTitle", "Персонажи ещё впереди")
          }
          description={
            backendProcessing
              ? t(
                  "narra.backendMarkupProcessingDescription",
                  "Персонажи появятся здесь автоматически, когда новая разметка будет готова",
                )
              : t(
                  "narra.backendCharactersAheadDescription",
                  "Они появятся здесь после встречи с ними в тексте",
                )
          }
        >
          {backendProcessing ? <ActivityIndicator color={colors.primary} /> : null}
        </CenteredEmptyState>
      ) : characters.length === 0 ? (
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
    backendProgress: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
      backgroundColor: colors.primary5,
    },
    backendProgressText: {
      flex: 1,
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
    },
    avatarImage: { width: "100%", height: "100%" },
  });
