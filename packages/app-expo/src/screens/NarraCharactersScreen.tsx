import { AnimatedNarraFace } from "@/components/chat/animated-narra-face";
import { NARRA_CHAT_EMBEDDED_TOP_INSET } from "@/components/chat/narra-chat-header";
import {
  CharacterChatAvatar,
  CharacterChatList,
  type CharacterChatListItem,
} from "@/components/chats/character-chat-list";
import { CharacterPortraitImage } from "@/components/narra/character-portrait-image";
import { SystemSheetZoomDestination } from "@/components/navigation/SystemSheetZoomDestination";
import { Text } from "@/components/ui/Typography";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { useBackendBook } from "@/hooks/use-backend-book";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import { useBackendBookStatus } from "@/lib/narra/backend-book-sync";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import type { NarraCharacter } from "@/lib/narra/types";
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

const _MAX_AUTOMATIC_PORTRAIT_ATTEMPTS = 2;
const CONTENT_EXIT_DURATION_MS = 100;
const CONTENT_ENTER_DURATION_MS = 100;
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
  useBackendBook(book, isActive);
  const backendStatus = useBackendBookStatus((state) => state.books[bookId]);
  const openingChatRef = useRef(false);
  const storedCharacters = bookState?.characters ?? [];
  const visibleCharacters = useMemo(
    () =>
      storedCharacters.filter(
        (character) =>
          character.backendManaged && isCharacterUnlocked(book?.progress ?? 0, character),
      ),
    [storedCharacters, book?.progress],
  );
  const provisional =
    backendStatus?.manifest?.availability === "processing"
      ? backendStatus.manifest.characters.filter((item) => item.provisional)
      : [];
  const isFindingCharacters = backendStatus?.manifest?.availability === "processing";
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
        subtitle: character.role,
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
        <CharacterChatList
          items={provisional.map((item) => ({
            key: `preparing:${item.key}`,
            title: item.fullName,
            subtitle: "Профиль формируется…",
            accessibilityLabel: `${item.fullName}: профиль формируется`,
            dimmed: true,
            disabled: true,
            onPress: () => undefined,
            avatar: (
              <CharacterChatAvatar muted>
                <ActivityIndicator />
              </CharacterChatAvatar>
            ),
          }))}
        />
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
