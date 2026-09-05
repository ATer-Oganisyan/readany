import { AnimatedNarraFace } from "@/components/chat/animated-narra-face";
import { NARRA_CHAT_EMBEDDED_TOP_INSET } from "@/components/chat/narra-chat-header";
import {
  CharacterChatAvatar,
  CharacterChatList,
  type CharacterChatListItem,
} from "@/components/chats/character-chat-list";
import { CharacterPortraitImage } from "@/components/narra/character-portrait-image";
import { SystemSheetZoomDestination } from "@/components/navigation/SystemSheetZoomDestination";
import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { useBackendBook } from "@/hooks/use-backend-book";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import {
  retryBackendBookAnalysis,
  retryBackendBookSync,
  useBackendBookStatus,
} from "@/lib/narra/backend-book-sync";
import { characterBiography } from "@/lib/narra/character-profile";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import type { NarraCharacter } from "@/lib/narra/types";
import { toast } from "@/lib/notifications";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AccessibilityInfo,
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

const _MAX_AUTOMATIC_PORTRAIT_ATTEMPTS = 2;
const CONTENT_EXIT_DURATION_MS = 100;
const CONTENT_ENTER_DURATION_MS = 100;
// Native animation/rAF callbacks may be interrupted or never delivered. The
// visible destination must still become interactive once JS is running again.
const CONTENT_TRANSITION_TIMEOUT_MS = 600;
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
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionGenerationRef = useRef(0);
  const transitionTargetRef = useRef<SheetContent>({ kind: "characters" });
  const transitioningRef = useRef(false);
  const mountedRef = useRef(true);
  const listOpacity = useRef(new RNAnimated.Value(1)).current;
  // GlassView нельзя монтировать под opacity: 0: эффект может не восстановиться.
  // Поэтому чат всегда непрозрачный, а fade рисует обычная шторка поверх него.
  const chatCoverOpacity = useRef(new RNAnimated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const { colors } = useTheme();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      transitionGenerationRef.current++;
      if (transitionTimeoutRef.current !== null) {
        clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
      if (transitionFrameRef.current !== null) {
        cancelAnimationFrame(transitionFrameRef.current);
        transitionFrameRef.current = null;
      }
      listOpacity.stopAnimation();
      chatCoverOpacity.stopAnimation();
      transitioningRef.current = false;
    };
  }, [chatCoverOpacity, listOpacity]);

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
    if (!mountedRef.current) return;
    transitioningRef.current = false;
    transitionGenerationRef.current++;
    if (transitionTimeoutRef.current !== null) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    if (transitionFrameRef.current !== null) {
      cancelAnimationFrame(transitionFrameRef.current);
      transitionFrameRef.current = null;
    }
    listOpacity.stopAnimation();
    chatCoverOpacity.stopAnimation();
    const target = transitionTargetRef.current;
    listOpacity.setValue(target.kind === "characters" ? 1 : 0);
    chatCoverOpacity.setValue(target.kind === "characters" ? 1 : 0);
    setContent(target);
    setIsTransitioning(false);
  }, [chatCoverOpacity, listOpacity]);

  const isCurrentTransition = useCallback((generation: number) => {
    return (
      mountedRef.current &&
      transitioningRef.current &&
      transitionGenerationRef.current === generation
    );
  }, []);

  const beginTransition = useCallback(
    (target: SheetContent) => {
      if (!mountedRef.current || transitioningRef.current) return null;
      const generation = ++transitionGenerationRef.current;
      transitionTargetRef.current = target;
      transitioningRef.current = true;
      setIsTransitioning(true);
      listOpacity.stopAnimation();
      chatCoverOpacity.stopAnimation();
      transitionTimeoutRef.current = setTimeout(() => {
        if (isCurrentTransition(generation)) finishTransition();
      }, CONTENT_TRANSITION_TIMEOUT_MS);
      return generation;
    },
    [chatCoverOpacity, finishTransition, isCurrentTransition, listOpacity],
  );

  const fadeIn = useCallback(
    (value: RNAnimated.Value, generation: number) => {
      transitionFrameRef.current = requestAnimationFrame(() => {
        if (!isCurrentTransition(generation)) return;
        transitionFrameRef.current = null;
        animateOpacity({
          value,
          toValue: 1,
          duration: CONTENT_ENTER_DURATION_MS,
          easing: CONTENT_ENTER_EASING,
          reduceMotion,
          onComplete: () => {
            if (isCurrentTransition(generation)) finishTransition();
          },
        });
      });
    },
    [finishTransition, isCurrentTransition, reduceMotion],
  );

  const showCharacters = useCallback(() => {
    if (transitioningRef.current || content.kind === "characters") return;
    const generation = beginTransition({ kind: "characters" });
    if (generation === null) return;

    animateOpacity({
      value: chatCoverOpacity,
      toValue: 1,
      duration: CONTENT_EXIT_DURATION_MS,
      easing: CONTENT_EXIT_EASING,
      reduceMotion,
      onComplete: () => {
        if (!isCurrentTransition(generation)) return;
        setContent({ kind: "characters" });
        fadeIn(listOpacity, generation);
      },
    });
  }, [
    beginTransition,
    chatCoverOpacity,
    content.kind,
    fadeIn,
    isCurrentTransition,
    listOpacity,
    reduceMotion,
  ]);

  const showChat = useCallback(
    (nextContent: Exclude<SheetContent, { kind: "characters" }>) => {
      if (transitioningRef.current || content.kind !== "characters") return;
      const generation = beginTransition(nextContent);
      if (generation === null) return;

      animateOpacity({
        value: listOpacity,
        toValue: 0,
        duration: CONTENT_EXIT_DURATION_MS,
        easing: CONTENT_EXIT_EASING,
        reduceMotion,
        onComplete: () => {
          if (!isCurrentTransition(generation)) return;
          chatCoverOpacity.setValue(reduceMotion ? 0 : 1);
          setContent(nextContent);

          if (reduceMotion) {
            finishTransition();
            return;
          }

          transitionFrameRef.current = requestAnimationFrame(() => {
            if (!isCurrentTransition(generation)) return;
            transitionFrameRef.current = null;
            animateOpacity({
              value: chatCoverOpacity,
              toValue: 0,
              duration: CONTENT_ENTER_DURATION_MS,
              easing: CONTENT_ENTER_EASING,
              reduceMotion: false,
              onComplete: () => {
                if (isCurrentTransition(generation)) finishTransition();
              },
            });
          });
        },
      });
    },
    [
      beginTransition,
      chatCoverOpacity,
      content.kind,
      finishTransition,
      isCurrentTransition,
      listOpacity,
      reduceMotion,
    ],
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
  useBackendBook(book, isActive);
  const backendStatus = useBackendBookStatus((state) => state.books[bookId]);
  const openingChatRef = useRef(false);
  const storedCharacters = bookState?.characters ?? [];
  const analysisAvailability =
    backendStatus?.manifest?.availability ?? (backendStatus?.error ? "unavailable" : undefined);
  const charactersStatus = backendStatus?.manifest?.charactersStatus;
  const fullMarkupReady =
    charactersStatus === "full_ready" ||
    (!charactersStatus && bookState?.backendManifest?.availability === "ready");
  const visibleCharacters = useMemo(
    () =>
      fullMarkupReady
        ? storedCharacters.filter(
            (character) =>
              character.backendManaged && isCharacterUnlocked(book?.progress ?? 0, character),
          )
        : [],
    [fullMarkupReady, storedCharacters, book?.progress],
  );
  const preliminaryCharacters = useMemo(
    () =>
      backendStatus?.manifest?.charactersStatus === "preview_ready" &&
      backendStatus.preview?.status === "preview_ready"
        ? backendStatus.preview.characters
        : [],
    [backendStatus?.manifest?.charactersStatus, backendStatus?.preview],
  );
  const isFindingCharacters = analysisAvailability === "processing";
  const analysisTerminal =
    analysisAvailability === "failed" || analysisAvailability === "cancelled";
  const sourceUnavailable = backendStatus?.error === "SOURCE_UNAVAILABLE";
  const formatUnsupported = backendStatus?.error === "BOOK_FORMAT_UNSUPPORTED";
  const canRetry = !!book && !sourceUnavailable && !formatUnsupported;
  const privateBinding = bookState?.backendBinding?.resolution === "private";
  const [retrying, setRetrying] = useState(false);
  const retryingRef = useRef(false);
  const retryMountedRef = useRef(true);
  useEffect(() => {
    retryMountedRef.current = true;
    return () => {
      retryMountedRef.current = false;
    };
  }, []);
  const retryCharacters = useCallback(async () => {
    if (!canRetry || retryingRef.current || backendStatus?.analysisRetrying) return;
    retryingRef.current = true;
    setRetrying(true);
    try {
      // A missing binding or failed download is not a failed analysis run.
      // Reconnect/rebind first; only a terminal private run can be restarted.
      if (analysisTerminal && privateBinding) await retryBackendBookAnalysis(bookId);
      else await retryBackendBookSync(bookId);
    } catch {
      if (retryMountedRef.current)
        toast.error(t("narra.analysisFailed", "Не удалось загрузить персонажей"));
    } finally {
      retryingRef.current = false;
      if (retryMountedRef.current) setRetrying(false);
    }
  }, [analysisTerminal, backendStatus?.analysisRetrying, bookId, canRetry, privateBinding, t]);
  const shownAnalysisFailureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!analysisTerminal) {
      shownAnalysisFailureRef.current = null;
      return;
    }
    const failureKey = `${analysisAvailability}:${backendStatus?.manifest?.analysis?.updatedAt ?? ""}`;
    if (shownAnalysisFailureRef.current === failureKey) return;
    shownAnalysisFailureRef.current = failureKey;
    toast.error(t("narra.analysisFailed", "Не удалось загрузить персонажей"), {
      action: canRetry
        ? {
            label: t("common.retry", "Повторить"),
            onClick: retryCharacters,
          }
        : undefined,
    });
  }, [analysisAvailability, analysisTerminal, backendStatus, canRetry, retryCharacters, t]);
  useEffect(() => {
    recordTelemetry("character_opened", { feature: "character" });
  }, []);
  useEffect(() => {
    if (isActive) openingChatRef.current = false;
  }, [isActive]);

  const openCharacterChat = useCallback(
    (character: NarraCharacter) => {
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
    [bookId, navigation, onOpenCharacterChat],
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
      subtitle: isFindingCharacters
        ? t("narra.findingCharacters", "Ищу персонажей…")
        : t("narra.askAboutBook", "Спросите что угодно о книге"),
      onPress: openBookChat,
      avatar: (
        <CharacterChatAvatar muted>
          <AnimatedNarraFace width={38} height={40} />
        </CharacterChatAvatar>
      ),
    },
    ...visibleCharacters.map((character): CharacterChatListItem => {
      return {
        key: character.id,
        accessibilityLabel: t("narra.openCharacterChat", "Открыть чат с {{character}}", {
          character: character.name,
        }),
        title: character.fullName || character.name,
        subtitle: characterBiography(character),
        onPress: () => openCharacterChat(character),
        avatar: (
          <CharacterChatAvatar>
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
    ...preliminaryCharacters.map(
      (character): CharacterChatListItem => ({
        key: `preview:${character.key}`,
        accessibilityLabel: t(
          "narra.characterProfilePreparingLabel",
          "Профиль {{character}} формируется",
          { character: character.fullName || character.name },
        ),
        title: character.fullName || character.name,
        subtitle: t("narra.characterProfilePreparing", "Профиль формируется…"),
        disabled: true,
        dimmed: true,
        onPress: () => undefined,
        avatar: (
          <CharacterChatAvatar muted>
            <InitialsAvatar
              size={56}
              userId={`${bookId}:preview:${character.key}`}
              name={character.fullName || character.name}
            />
          </CharacterChatAvatar>
        ),
      }),
    ),
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
        <CharacterChatList items={listItems} />
        {analysisAvailability === "unavailable" || analysisTerminal ? (
          <View style={styles.analysisState}>
            <Text style={styles.analysisStateTitle}>
              {formatUnsupported
                ? t("narra.analysisFormatUnsupported", "Персонажи недоступны для этого формата")
                : sourceUnavailable
                  ? t("narra.analysisSourceUnavailable", "Нужен исходный файл книги")
                  : t("narra.analysisFailed", "Не удалось загрузить персонажей")}
            </Text>
            <Text style={styles.analysisStateDescription}>
              {formatUnsupported
                ? t(
                    "narra.analysisFormatUnsupportedHint",
                    "Книгу можно читать. Для персонажей добавьте версию EPUB, FB2, TXT или PDF.",
                  )
                : sourceUnavailable
                  ? t(
                      "narra.analysisSourceUnavailableHint",
                      "Добавьте тот же исходный файл снова для подготовки персонажей. Можно продолжать читать — прогресс сохранён.",
                    )
                  : t(
                      "narra.analysisFailedHint",
                      "Можно продолжать читать. Попробуйте загрузить персонажей ещё раз.",
                    )}
            </Text>
            {canRetry ? (
              <NativeButton
                label={t("common.retry", "Повторить")}
                onPress={retryCharacters}
                loading={retrying || !!backendStatus?.analysisRetrying}
                disabled={retrying || !!backendStatus?.analysisRetrying}
                variant="secondary"
                icon="refresh"
                style={{ alignSelf: "center" }}
              />
            ) : null}
          </View>
        ) : null}
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
    analysisState: {
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl,
    },
    analysisStateTitle: {
      color: colors.foreground,
      fontSize: 17,
      fontWeight: fontWeight.semibold,
      textAlign: "center",
    },
    analysisStateDescription: {
      color: colors.mutedForeground,
      lineHeight: 20,
      textAlign: "center",
    },
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
