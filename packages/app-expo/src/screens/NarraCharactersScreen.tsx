import { AnimatedNarraFace } from "@/components/chat/animated-narra-face";
import { NARRA_CHAT_EMBEDDED_TOP_INSET } from "@/components/chat/narra-chat-header";
import {
  CharacterChatAvatar,
  CharacterChatList,
  type CharacterChatListItem,
} from "@/components/chats/character-chat-list";
import { CharacterPortraitImage } from "@/components/narra/character-portrait-image";
import { SystemSheetZoomDestination } from "@/components/navigation/SystemSheetZoomDestination";
import { type ExtractorRef, ExtractorWebView } from "@/components/rag/ExtractorWebView";
import { Text } from "@/components/ui/Typography";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import { getBundledCatalogCharactersByTitle } from "@/lib/narra/bundled-catalog-characters";
import { analyzeBookCharacters } from "@/lib/narra/character-analysis";
import { hasCharacterPortrait } from "@/lib/narra/character-portrait";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import { NarraServiceError, reportNarraError } from "@/lib/narra/errors";
import { ensureCharacterPortrait, normalizePersistedNarraMediaUri } from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
import { toast } from "@/lib/notifications";
import { inspectMobileBookForVectorize } from "@/lib/rag/auto-vectorize-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { ChatScreen } from "@/screens/ChatScreen";
import { NarraCharacterChatScreen } from "@/screens/NarraCharacterChatScreen";
import { useLibraryStore, useNarraStore } from "@/stores";
import {
  ElevatedSurfaceTheme,
  type ThemeColors,
  fontWeight,
  spacing,
  useTheme,
} from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Easing,
  Platform,
  Animated as RNAnimated,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "NarraCharacters">;
type CharactersListProps = Props & {
  isActive?: boolean;
  onOpenBookChat?: () => void;
  onOpenCharacterChat?: (characterId: string) => void;
};

type SheetContent =
  | { kind: "characters" }
  | { kind: "bookChat" }
  | { kind: "characterChat"; characterId: string };

const MAX_AUTOMATIC_PORTRAIT_ATTEMPTS = 2;
const CONTENT_EXIT_DURATION_MS = 120;
const CONTENT_ENTER_DURATION_MS = 180;
const CONTENT_EXIT_EASING = Easing.bezier(0.4, 0, 1, 1);
const CONTENT_ENTER_EASING = Easing.bezier(0.2, 0, 0, 1);
const USES_CHARACTERS_SHEET = Platform.OS === "ios";

function animateOpacity({
  duration,
  easing,
  onComplete,
  reduceMotion,
  toValue,
  value,
}: {
  duration: number;
  easing: (value: number) => number;
  onComplete: () => void;
  reduceMotion: boolean;
  toValue: number;
  value: RNAnimated.Value;
}) {
  if (reduceMotion) {
    value.setValue(toValue);
    onComplete();
    return;
  }

  RNAnimated.timing(value, {
    duration,
    easing,
    toValue,
    useNativeDriver: true,
  }).start(({ finished }) => {
    if (finished) onComplete();
  });
}

export function NarraCharactersScreen({ route, navigation }: Props) {
  if (USES_CHARACTERS_SHEET) {
    // Экран живёт только как шторка поверх ридера, поэтому вся его поверхность —
    // включая встроенные чаты — приподнята относительно фона книги.
    return (
      <ElevatedSurfaceTheme>
        <NarraCharactersSheetFlow route={route} navigation={navigation} />
      </ElevatedSurfaceTheme>
    );
  }

  return <NarraCharactersList route={route} navigation={navigation} />;
}

function NarraCharactersSheetFlow({ route, navigation }: Props) {
  const [content, setContent] = useState<SheetContent>({ kind: "characters" });
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionFrameRef = useRef<number | null>(null);
  const transitioningRef = useRef(false);
  const mountedRef = useRef(true);
  const listOpacity = useRef(new RNAnimated.Value(1)).current;
  // GlassView нельзя монтировать под opacity: 0: эффект может не восстановиться.
  // Поэтому чат всегда непрозрачный, а fade рисует обычная шторка поверх него.
  const chatCoverOpacity = useRef(new RNAnimated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const { colors } = useTheme();

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (transitionFrameRef.current !== null) {
        cancelAnimationFrame(transitionFrameRef.current);
      }
      listOpacity.stopAnimation();
      chatCoverOpacity.stopAnimation();
      transitioningRef.current = false;
    },
    [chatCoverOpacity, listOpacity],
  );

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const finishTransition = useCallback(() => {
    transitioningRef.current = false;
    if (mountedRef.current) setIsTransitioning(false);
  }, []);

  const fadeIn = useCallback(
    (value: RNAnimated.Value, onComplete: () => void) => {
      transitionFrameRef.current = requestAnimationFrame(() => {
        transitionFrameRef.current = null;
        animateOpacity({
          value,
          toValue: 1,
          duration: CONTENT_ENTER_DURATION_MS,
          easing: CONTENT_ENTER_EASING,
          reduceMotion,
          onComplete,
        });
      });
    },
    [reduceMotion],
  );

  const showCharacters = useCallback(() => {
    if (transitioningRef.current || content.kind === "characters") return;
    if (transitionFrameRef.current !== null) {
      cancelAnimationFrame(transitionFrameRef.current);
      transitionFrameRef.current = null;
    }
    listOpacity.stopAnimation();
    chatCoverOpacity.stopAnimation();
    transitioningRef.current = true;
    setIsTransitioning(true);

    animateOpacity({
      value: chatCoverOpacity,
      toValue: 1,
      duration: CONTENT_EXIT_DURATION_MS,
      easing: CONTENT_EXIT_EASING,
      reduceMotion,
      onComplete: () => {
        setContent({ kind: "characters" });
        fadeIn(listOpacity, finishTransition);
      },
    });
  }, [chatCoverOpacity, content.kind, fadeIn, finishTransition, listOpacity, reduceMotion]);

  const showChat = useCallback(
    (nextContent: Exclude<SheetContent, { kind: "characters" }>) => {
      if (transitioningRef.current || content.kind !== "characters") return;
      transitioningRef.current = true;
      setIsTransitioning(true);

      animateOpacity({
        value: listOpacity,
        toValue: 0,
        duration: CONTENT_EXIT_DURATION_MS,
        easing: CONTENT_EXIT_EASING,
        reduceMotion,
        onComplete: () => {
          chatCoverOpacity.setValue(reduceMotion ? 0 : 1);
          setContent(nextContent);

          if (reduceMotion) {
            finishTransition();
            return;
          }

          transitionFrameRef.current = requestAnimationFrame(() => {
            transitionFrameRef.current = null;
            animateOpacity({
              value: chatCoverOpacity,
              toValue: 0,
              duration: CONTENT_ENTER_DURATION_MS,
              easing: CONTENT_ENTER_EASING,
              reduceMotion: false,
              onComplete: finishTransition,
            });
          });
        },
      });
    },
    [chatCoverOpacity, content.kind, finishTransition, listOpacity, reduceMotion],
  );

  const showBookChat = useCallback(() => {
    showChat({ kind: "bookChat" });
  }, [showChat]);
  const showCharacterChat = useCallback(
    (characterId: string) => {
      showChat({ kind: "characterChat", characterId });
    },
    [showChat],
  );

  const listIsActive = content.kind === "characters" && !isTransitioning;
  const chatIsActive = content.kind !== "characters" && !isTransitioning;

  return (
    <View style={[flowStyles.container, { backgroundColor: colors.background }]}>
      <SystemSheetZoomDestination
        sourceId={route.params.charactersSheetSourceId}
        expanded={content.kind !== "characters"}
      />
      <View style={flowStyles.contentStack}>
        <RNAnimated.View
          accessibilityElementsHidden={!listIsActive}
          importantForAccessibility={listIsActive ? "auto" : "no-hide-descendants"}
          pointerEvents={listIsActive ? "auto" : "none"}
          style={[flowStyles.contentLayer, { opacity: listOpacity }]}
        >
          <NarraCharactersList
            route={route}
            navigation={navigation}
            isActive={listIsActive}
            onOpenBookChat={showBookChat}
            onOpenCharacterChat={showCharacterChat}
          />
        </RNAnimated.View>

        {content.kind !== "characters" ? (
          <View
            accessibilityElementsHidden={!chatIsActive}
            importantForAccessibility={chatIsActive ? "auto" : "no-hide-descendants"}
            pointerEvents={chatIsActive ? "auto" : "none"}
            style={flowStyles.contentLayer}
          >
            {content.kind === "bookChat" ? (
              <ChatScreen embedded embeddedBookId={route.params.bookId} onBack={showCharacters} />
            ) : (
              <NarraCharacterChatScreen
                embedded
                bookId={route.params.bookId}
                characterId={content.characterId}
                onBack={showCharacters}
              />
            )}
            <RNAnimated.View
              pointerEvents="none"
              style={[
                flowStyles.transitionCover,
                { backgroundColor: colors.background, opacity: chatCoverOpacity },
              ]}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function NarraCharactersList({
  route,
  navigation,
  isActive = true,
  onOpenBookChat,
  onOpenCharacterChat,
}: CharactersListProps) {
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
  const portraitAttemptsRef = useRef(new Map<string, number>());
  const validatedPortraitsRef = useRef(new Set<string>());
  const validatedBookIdRef = useRef(bookId);
  const autoAnalysisStartedRef = useRef(false);
  const openingChatRef = useRef(false);
  const [analysisStage, setAnalysisStage] = useState("");
  const [portraitLoading, setPortraitLoading] = useState<string | null>(null);
  const storedCharacters = bookState?.characters ?? [];
  const bundledCharacters = useMemo(
    () => (book ? getBundledCatalogCharactersByTitle(book.meta.title) : undefined),
    [book],
  );
  const characters = storedCharacters.length > 0 ? storedCharacters : (bundledCharacters ?? []);
  const visibleCharacters = useMemo(() => {
    const progress = book?.progress ?? 0;
    return characters.filter((character) => isCharacterUnlocked(progress, character));
  }, [book?.progress, characters]);
  const busy = analyzing || Boolean(analysisStage);

  useEffect(() => {
    recordTelemetry("character_opened", { feature: "character" });
  }, []);

  useEffect(() => {
    if (isActive) openingChatRef.current = false;
  }, [isActive]);

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
      portraitAttemptsRef.current.clear();
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
          toast.error(t("narra.analysisFailedTitle", "Не удалось найти персонажей"), {
            description:
              __DEV__ && detail !== normalized.message
                ? `${normalized.message}\n\nДиагностика: ${detail}`
                : normalized.message,
          });
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
        (portraitAttemptsRef.current.get(character.id) ?? 0) < MAX_AUTOMATIC_PORTRAIT_ATTEMPTS,
    );
    if (!nextCharacter) return;

    portraitAttemptsRef.current.set(
      nextCharacter.id,
      (portraitAttemptsRef.current.get(nextCharacter.id) ?? 0) + 1,
    );
    setPortraitLoading(nextCharacter.id);
    void ensureCharacterPortrait(bookId, nextCharacter)
      .then((portraitUri) => updateCharacter(bookId, nextCharacter.id, { portraitUri }))
      .catch((error) => reportNarraError("character_portrait_background", error))
      .finally(() => setPortraitLoading(null));
  }, [book, bookId, busy, characters, portraitLoading, updateCharacter]);

  const openCharacterChat = useCallback(
    (character: NarraCharacter) => {
      // Чат ищет героя в narra-store — bundled-фолбэк сначала фиксируем там.
      if (storedCharacters.length === 0 && bundledCharacters?.length) {
        setCharacters(bookId, bundledCharacters);
      }
      if (!USES_CHARACTERS_SHEET) {
        navigation.navigate("NarraCharacterChat", {
          bookId,
          characterId: character.id,
        });
        return;
      }
      if (openingChatRef.current) return;
      openingChatRef.current = true;
      if (onOpenCharacterChat) {
        onOpenCharacterChat(character.id);
      } else {
        navigation.navigate("NarraCharacterChat", {
          bookId,
          characterId: character.id,
        });
      }
    },
    [
      bookId,
      bundledCharacters,
      navigation,
      onOpenCharacterChat,
      setCharacters,
      storedCharacters.length,
    ],
  );

  const openBookChat = useCallback(() => {
    if (!USES_CHARACTERS_SHEET) {
      navigation.navigate("BookChat", { bookId });
      return;
    }
    if (openingChatRef.current) return;
    openingChatRef.current = true;
    if (onOpenBookChat) {
      onOpenBookChat();
    } else {
      navigation.navigate("BookChat", { bookId });
    }
  }, [bookId, navigation, onOpenBookChat]);

  const listItems: CharacterChatListItem[] = [
    {
      key: "narra",
      accessibilityLabel: t("narra.openNarraBookChat", "Открыть чат с Narra об этой книге"),
      title: "Narra",
      subtitle: t("narra.askAboutBook", "Спросите что угодно о книге"),
      onPress: openBookChat,
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
              resizeMode="cover"
              cropAnchor="top"
              staticOnly
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
    <View style={styles.container}>
      {USES_CHARACTERS_SHEET ? (
        <View pointerEvents="none" style={styles.sheetNavigationBar}>
          <Text style={styles.sheetNavigationTitle}>{t("narra.characters", "Персонажи")}</Text>
        </View>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior={USES_CHARACTERS_SHEET ? "never" : "automatic"}
        contentContainerStyle={[styles.content, USES_CHARACTERS_SHEET && styles.sheetContent]}
        style={styles.scrollView}
      >
        <ExtractorWebView ref={extractorRef} />
        <CharacterChatList items={listItems} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scrollView: { flex: 1, backgroundColor: colors.background },
    sheetNavigationBar: {
      position: "absolute",
      top: 0,
      right: 0,
      left: 0,
      zIndex: 2,
      height: 52 + NARRA_CHAT_EMBEDDED_TOP_INSET,
      paddingTop: 8 + NARRA_CHAT_EMBEDDED_TOP_INSET,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    sheetNavigationTitle: {
      color: colors.foreground,
      fontSize: 17,
      fontWeight: fontWeight.semibold,
      lineHeight: 22,
      letterSpacing: -0.4,
    },
    sheetContent: { paddingTop: 60 + NARRA_CHAT_EMBEDDED_TOP_INSET },
    content: {
      flexGrow: 1,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl,
    },
    avatarImage: { width: "100%", height: "100%" },
  });

const flowStyles = StyleSheet.create({
  container: { flex: 1 },
  contentStack: { flex: 1 },
  contentLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  transitionCover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
  },
});
