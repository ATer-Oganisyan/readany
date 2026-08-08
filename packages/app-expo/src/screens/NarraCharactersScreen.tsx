import { AnimatedNarraFace } from "@/components/chat/animated-narra-face";
import {
  CharacterChatAvatar,
  CharacterChatList,
  type CharacterChatListItem,
} from "@/components/chats/character-chat-list";
import { type ExtractorRef, ExtractorWebView } from "@/components/rag/ExtractorWebView";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import { getBundledCatalogCharactersByTitle } from "@/lib/narra/bundled-catalog-characters";
import { analyzeBookCharacters } from "@/lib/narra/character-analysis";
import { hasCharacterPortrait, resolveCharacterPortraitUri } from "@/lib/narra/character-portrait";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import { NarraServiceError, reportNarraError } from "@/lib/narra/errors";
import { ensureCharacterPortrait, normalizePersistedNarraMediaUri } from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
import { inspectMobileBookForVectorize } from "@/lib/rag/auto-vectorize-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { ReaderCharacterCard } from "@/screens/reader/ReaderCharacterCard";
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
  /** Герой, чья карточка открыта в bottom-sheet (тап → карточка → чат, как в «Моём пути»). */
  const [selectedCharacter, setSelectedCharacter] = useState<NarraCharacter | null>(null);
  const storedCharacters = bookState?.characters ?? [];
  const bundledCharacters = useMemo(
    () => (book ? getBundledCatalogCharactersByTitle(book.meta.title) : undefined),
    [book],
  );
  const characters = storedCharacters.length > 0 ? storedCharacters : (bundledCharacters ?? []);
  // Открытые — в порядке значимости из анализа; запертые — по порогу открытия
  const orderedCharacters = useMemo(() => {
    const progress = book?.progress ?? 0;
    const unlocked = characters.filter((character) => isCharacterUnlocked(progress, character));
    const locked = characters
      .filter((character) => !isCharacterUnlocked(progress, character))
      .sort((a, b) => a.unlockProgress - b.unlockProgress);
    return [...unlocked, ...locked];
  }, [book?.progress, characters]);
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

  const openCharacterCard = useCallback(
    (character: NarraCharacter) => {
      // Карточка и чат ищут героя в narra-store — bundled-фолбэк сначала фиксируем там
      if (storedCharacters.length === 0 && bundledCharacters?.length) {
        setCharacters(bookId, bundledCharacters);
      }
      setSelectedCharacter(character);
    },
    [bookId, bundledCharacters, setCharacters, storedCharacters.length],
  );

  const openCharacterChat = useCallback(
    (character: NarraCharacter) => {
      setSelectedCharacter(null);
      navigation.navigate("NarraCharacterChat", { bookId, characterId: character.id });
    },
    [bookId, navigation],
  );

  /** «Продолжить чтение» из тизера запертого героя — в ридер этой книги. */
  const continueReading = useCallback(() => {
    setSelectedCharacter(null);
    void openMobileBook({ bookId, navigation, t });
  }, [bookId, navigation, t]);

  const listItems: CharacterChatListItem[] = [
    {
      key: "narra",
      accessibilityLabel: "Открыть чат с Наррой о книге",
      title: "Нарра",
      subtitle: "Спросите что угодно о книге",
      onPress: () => navigation.navigate("BookChat", { bookId }),
      avatar: (
        <CharacterChatAvatar muted>
          <AnimatedNarraFace width={38} height={40} />
        </CharacterChatAvatar>
      ),
    },
    ...orderedCharacters.map((character): CharacterChatListItem => {
      const portraitBusy = portraitLoading === character.id;
      const portraitUri = resolveCharacterPortraitUri(character);
      const unlocked = isCharacterUnlocked(book?.progress ?? 0, character);
      const unlockPercent = Math.round(Math.min(1, Math.max(0, character.unlockProgress)) * 100);
      const lockedSubtitle = character.appearanceChapter
        ? t("narra.appearsInChapter", "появится в главе {{chapter}}", {
            chapter: character.appearanceChapter,
          })
        : t("narra.unlocksAtPercent", "откроется на {{percent}}%", {
            percent: unlockPercent,
          });
      const accessibilityLabel = unlocked
        ? t("myPath.openCharacter", "Открыть карточку {{character}}", {
            character: character.name,
          })
        : character.appearanceChapter
          ? t("narra.lockedCharacterChapterLabel", "{{character}} появится в главе {{chapter}}", {
              character: character.name,
              chapter: character.appearanceChapter,
            })
          : t("narra.lockedCharacterLabel", "{{character}} откроется на {{percent}}%", {
              character: character.name,
              percent: unlockPercent,
            });

      return {
        key: character.id,
        accessibilityLabel,
        title: unlocked ? character.fullName : character.name,
        subtitle: unlocked ? character.role : lockedSubtitle,
        dimmed: !unlocked,
        onPress: () => openCharacterCard(character),
        avatar: (
          <CharacterChatAvatar
            overlay={
              portraitBusy && hasCharacterPortrait(character) ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : undefined
            }
          >
            {portraitUri ? (
              <Image
                source={{ uri: portraitUri }}
                style={styles.avatarImage}
                onError={
                  character.portraitUri
                    ? () => updateCharacter(bookId, character.id, { portraitUri: undefined })
                    : undefined
                }
              />
            ) : (
              <InitialsAvatar
                size={56}
                userId={`${bookId}:${character.id}`}
                name={character.fullName || character.name}
              />
            )}
          </CharacterChatAvatar>
        ),
      };
    }),
  ];

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        style={styles.container}
      >
        <ExtractorWebView ref={extractorRef} />
        <CharacterChatList items={listItems} />
        {characters.length === 0 ? (
          <CenteredEmptyState
            title={t("narra.meetCharacters", "Персонажей пока нет")}
            description={t("narra.analysisDescription", "Найдём их в тексте книги")}
          >
            <View style={styles.emptyActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={
                  busy ? analysisStage : t("narra.findCharacters", "Найти героев")
                }
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
      {/* Карточка героя — тот же bottom-sheet, что в ридере и «Моём пути»: тап → карточка → чат */}
      <ReaderCharacterCard
        visible={!!selectedCharacter}
        character={selectedCharacter}
        bookId={bookId}
        onClose={() => setSelectedCharacter(null)}
        onOpenChat={openCharacterChat}
        onContinueReading={continueReading}
      />
    </>
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
    avatarImage: { width: "100%", height: "100%" },
  });
