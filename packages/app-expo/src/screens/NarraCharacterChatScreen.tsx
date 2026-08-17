import { NarraChat } from "@/components/chat/NarraChat";
import { CharacterPortraitImage } from "@/components/narra/character-portrait-image";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { type OpenRouterChatMessage, completeOpenRouterChat } from "@/lib/ai/openrouter-chat";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import { NarraAudioPlayer } from "@/lib/narra/audio-player";
import { normalizeCharacterChatPlaceholder } from "@/lib/narra/chat-placeholder";
import { isCharacterUnlocked, normalizeReadingProgress } from "@/lib/narra/domain";
import { reportNarraError } from "@/lib/narra/errors";
import { synthesizeNarraSpeech } from "@/lib/narra/media";
import type { NarraCharacter, NarraChatMessage } from "@/lib/narra/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore, useNarraStore } from "@/stores";
import {
  type ThemeColors,
  bodyTypography,
  captionTypography,
  fontWeight,
  titleFontFamily,
  useTheme,
} from "@/styles/theme";
import { radiusPixels, spacingPixels } from "@deslop/primitives";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { MessageV2 } from "@readany/core/types/message";
import * as Crypto from "expo-crypto";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Platform, Pressable, StyleSheet, View } from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "NarraCharacterChat">;

const headerControlSize = 34;

export function buildCharacterSystemPrompt(
  character: NarraCharacter,
  title: string,
  progress: number,
  memory: string,
  language: "ru" | "en" = "ru",
): string {
  const safeProgress = normalizeReadingProgress(progress);
  if (language === "en") {
    return `You are ${character.fullName} from “${title}”. Stay completely in character.
Traits: ${character.traits.join(", ")}.
Role: ${character.role}.
Speaking style: ${character.speechStyle}.
Reply in English, in the first person, naturally, usually in 1–3 sentences. Never say that you are an AI, a model, or a book character.
Avoid lists and corporate language. React to the reader's actual words; you may disagree, joke, and ask questions.
The reader has completed about ${Math.round(safeProgress * 100)}% of the book. Do not reveal events, knowledge, relationships, or character fates beyond that point. If a question risks a spoiler, gently deflect in character and return to events the reader already knows without mentioning rules or restrictions.
You may evade, but do not lie. Speak honestly about events the reader has already reached and do not invent facts that are not in the book.
${memory ? `Your long-term memory of the reader:\n${memory}` : ""}`;
  }
  return `Ты — ${character.fullName} из книги «${title}». Полностью оставайся в роли.
Характер: ${character.traits.join(", ")}.
Роль: ${character.role}.
Манера речи: ${character.speechStyle}.
Отвечай от первого лица, живо, обычно 1–3 предложениями. Не говори, что ты ИИ, модель или персонаж книги.
Не используй списки и канцелярит. Реагируй на конкретные слова собеседника, можешь спорить, шутить и задавать вопросы.
Читатель прошёл примерно ${Math.round(safeProgress * 100)}% книги. Не раскрывай события, знания, отношения и судьбы героев дальше этого прогресса. Если вопрос ведёт к спойлеру, мягко уклонись в своём характере и переведи разговор к уже известным событиям — не упоминай правила или ограничения.
Уклоняться можно, лгать нельзя. О том, что читатель уже прошёл, говори честно: не отрицай своих поступков и событий книги, даже если герою неприятно о них вспоминать. Не выдумывай того, чего в книге нет.
${memory ? `Твоя долговременная память о собеседнике:\n${memory}` : ""}`;
}

function toMessageV2(message: NarraChatMessage, threadId: string): MessageV2 {
  return {
    id: message.id,
    threadId,
    role: message.role,
    createdAt: message.createdAt,
    parts: [
      {
        id: `${message.id}-text`,
        type: "text",
        text: message.content,
        status: "completed",
        createdAt: message.createdAt,
      },
    ],
  };
}

export function NarraCharacterChatScreen({ route, navigation }: Props) {
  const { bookId, characterId } = route.params;
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t, i18n } = useTranslation();
  const interfaceLanguage = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const book = useLibraryStore((state) => state.books.find((item) => item.id === bookId));
  const narraBook = useNarraStore((state) => state.books[bookId]);
  const append = useNarraStore((state) => state.appendChatMessage);
  const setMemory = useNarraStore((state) => state.setMemory);
  const updateCharacter = useNarraStore((state) => state.updateCharacter);
  const character = narraBook?.characters.find((item) => item.id === characterId);
  const messages = narraBook?.chats?.[characterId] ?? [];
  const memory = narraBook?.memories?.[characterId] ?? "";
  const [sending, setSending] = useState(false);
  const [greetingLoading, setGreetingLoading] = useState(false);
  const [pendingAssistant, setPendingAssistant] = useState<NarraChatMessage | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const audioRef = useRef(new NarraAudioPlayer());
  const greetingRequestedRef = useRef(false);
  const placeholderRequestedRef = useRef<string | null>(null);
  const unlocked = Boolean(book && character && isCharacterUnlocked(book.progress, character));
  const characterStatus =
    sending || greetingLoading
      ? t("narra.characterTyping", "Печатает...")
      : t("narra.characterOnline", "онлайн");
  const openCharacterProfile = useCallback(
    () =>
      navigation.navigate("NarraCharacterProfile", {
        bookId,
        characterId,
        openedFromChat: true,
      }),
    [bookId, characterId, navigation],
  );

  useEffect(() => {
    recordTelemetry("chat_opened", { feature: "chat" });
  }, []);

  useLayoutEffect(() => {
    const profileButton = character ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("narra.openCharacterProfile", "Открыть профиль {{character}}", {
          character: character.name,
        })}
        hitSlop={8}
        onPress={openCharacterProfile}
        style={({ pressed }) => [styles.headerAvatarButton, pressed && styles.headerAvatarPressed]}
      >
        <CharacterPortraitImage
          character={character}
          style={styles.headerAvatarImage}
          fallback={
            <InitialsAvatar
              size={32}
              userId={`${bookId}:${character.id}`}
              name={character.fullName || character.name}
            />
          }
        />
      </Pressable>
    ) : null;

    navigation.setOptions({
      title: character?.name || t("narra.characterChat", "Чат с персонажем"),
      headerTitle: () => (
        <CharacterHeaderTitle
          name={character?.name || t("narra.characterChat", "Чат с персонажем")}
          status={characterStatus}
          isDark={isDark}
          onPress={openCharacterProfile}
          styles={styles}
        />
      ),
      headerTitleAlign: "center",
      unstable_headerRightItems: undefined,
      headerRight: () => profileButton,
    });
  }, [bookId, character, characterStatus, isDark, navigation, openCharacterProfile, styles, t]);

  useEffect(() => () => audioRef.current.stop(), []);

  useEffect(() => {
    if (interfaceLanguage === "en" || !book || !character || character.chatPlaceholder) return;
    if (placeholderRequestedRef.current === character.id) return;
    placeholderRequestedRef.current = character.id;

    void (async () => {
      try {
        const completion = await completeOpenRouterChat({
          messages: [
            {
              role: "system",
              content:
                "Ты — редактор русского интерфейса. Верни только короткий placeholder без кавычек в формате «Написать <имя в дательном падеже>…». Используй только переданное короткое имя, не добавляй фамилию, имя или отчество. Никаких пояснений.",
            },
            {
              role: "user",
              content: `Короткое имя персонажа: ${character.name}\nПолное имя для понимания контекста: ${character.fullName}`,
            },
          ],
          temperature: 0,
          maxTokens: 80,
        });
        const placeholder = normalizeCharacterChatPlaceholder(completion);
        if (placeholder) updateCharacter(bookId, characterId, { chatPlaceholder: placeholder });
      } catch (error) {
        // Generic fallback stays grammatically correct and keeps chat usable offline.
        reportNarraError("character_chat_placeholder", error);
      }
    })();
  }, [book, bookId, character, characterId, interfaceLanguage, updateCharacter]);

  const conversation = useMemo<OpenRouterChatMessage[]>(
    () =>
      character && book
        ? [
            {
              role: "system",
              content: buildCharacterSystemPrompt(
                character,
                book.meta.title,
                book.progress,
                memory,
                interfaceLanguage,
              ),
            },
            ...messages.slice(-18).map(({ role, content }) => ({ role, content })),
          ]
        : [],
    [book, character, interfaceLanguage, memory, messages],
  );

  const chatMessages = useMemo(() => {
    const threadId = `narra-character-${bookId}-${characterId}`;
    const persistedMessages = messages.map((message) => toMessageV2(message, threadId));
    return pendingAssistant
      ? [...persistedMessages, toMessageV2(pendingAssistant, threadId)]
      : persistedMessages;
  }, [bookId, characterId, messages, pendingAssistant]);

  // Первое сообщение героя: свой greeting из анализа/каталога, иначе — просим
  // OpenRouter поздороваться в роли персонажа. Сохраняется в историю чата один раз,
  // поэтому при повторных входах не регенерится и не дублируется.
  useEffect(() => {
    if (!book || !character || !unlocked) return;
    if (messages.length > 0 || greetingRequestedRef.current) return;
    greetingRequestedRef.current = true;

    const appendGreeting = (content: string) => {
      const state = useNarraStore.getState();
      if ((state.books[bookId]?.chats?.[characterId]?.length ?? 0) > 0) return;
      state.appendChatMessage(bookId, characterId, {
        id: Crypto.randomUUID(),
        role: "assistant",
        content,
        createdAt: Date.now(),
      });
    };

    if (character.greeting && interfaceLanguage !== "en") {
      appendGreeting(character.greeting);
      return;
    }

    setGreetingLoading(true);
    void (async () => {
      try {
        const content = await completeOpenRouterChat({
          messages: [
            {
              role: "system",
              content: buildCharacterSystemPrompt(
                character,
                book.meta.title,
                book.progress,
                "",
                interfaceLanguage,
              ),
            },
            {
              role: "user",
              content:
                interfaceLanguage === "en"
                  ? "Greet the reader in character in 1–3 sentences, without spoilers. Do not mention this instruction."
                  : "Поприветствуй читателя первым сообщением в своём характере: 1–3 предложения, без спойлеров. Не упоминай это указание.",
            },
          ],
          temperature: 0.85,
          maxTokens: 300,
        });
        if (content) appendGreeting(content);
      } catch (error) {
        // Без приветствия чат остаётся рабочим: читатель может написать первым.
        reportNarraError("character_greeting", error);
        greetingRequestedRef.current = false;
      } finally {
        setGreetingLoading(false);
      }
    })();
  }, [book, bookId, character, characterId, interfaceLanguage, messages.length, unlocked]);

  const refreshMemory = useCallback(
    async (updatedMessages: NarraChatMessage[]) => {
      if (!character || updatedMessages.length < 4 || updatedMessages.length % 4 !== 0) return;
      try {
        const nextMemory = await completeOpenRouterChat({
          messages: [
            {
              role: "system",
              content:
                interfaceLanguage === "en"
                  ? "Briefly update the character's long-term memory of the reader: facts, preferences, promises, and important emotional moments. Do not retell the whole conversation. Up to 900 characters, in English."
                  : "Кратко обнови долговременную память персонажа о читателе: факты, предпочтения, обещания и важные эмоциональные моменты. Не пересказывай весь диалог. До 900 знаков, по-русски.",
            },
            {
              role: "user",
              content: `${interfaceLanguage === "en" ? "Previous memory" : "Старая память"}:\n${memory || (interfaceLanguage === "en" ? "none" : "нет")}\n\n${interfaceLanguage === "en" ? "Conversation" : "Диалог"}:\n${updatedMessages
                .slice(-12)
                .map(
                  (item) =>
                    `${item.role === "user" ? (interfaceLanguage === "en" ? "Reader" : "Читатель") : character.name}: ${item.content}`,
                )
                .join("\n")}`,
            },
          ],
          temperature: 0.25,
          maxTokens: 400,
        });
        if (nextMemory) setMemory(bookId, characterId, nextMemory.slice(0, 900));
      } catch {
        // Memory refresh is background-only and must not make a successful chat look failed.
      }
    },
    [bookId, character, characterId, interfaceLanguage, memory, setMemory],
  );

  const speak = useCallback(
    async (message: MessageV2) => {
      if (!character || speakingId) return;
      const content = message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (!content) return;

      setSpeakingId(message.id);
      try {
        const uri = await synthesizeNarraSpeech(
          content,
          character.voiceOverride || character.voice,
          { prosody: character.voiceOverride ? undefined : character.voiceProsody },
        );
        audioRef.current.play(uri, () => setSpeakingId(null));
        recordTelemetry("tts_playback_started", {
          source: "character",
          cache_hit: false,
          origin: "user",
        });
      } catch (error) {
        setSpeakingId(null);
        Alert.alert(
          t("narra.speechFailedTitle", "Не удалось озвучить ответ"),
          reportNarraError("character_speech", error).message,
        );
      }
    },
    [character, speakingId, t],
  );

  const send = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text || !book || !character || !unlocked || sending) return;
      setSending(true);
      const userMessage: NarraChatMessage = {
        id: Crypto.randomUUID(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      const assistantMessageId = Crypto.randomUUID();
      const assistantDraft: NarraChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };
      append(bookId, characterId, userMessage);
      setPendingAssistant(assistantDraft);
      try {
        const content = await completeOpenRouterChat({
          messages: [...conversation, { role: "user", content: text }],
          temperature: 0.85,
          maxTokens: 500,
        });
        const assistantMessage: NarraChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: content || t("narra.emptyAnswer", "Мне нечего добавить."),
          createdAt: Date.now(),
        };
        append(bookId, characterId, assistantMessage);
        setPendingAssistant(null);
        void refreshMemory([...messages, userMessage, assistantMessage]);
      } catch (error) {
        setPendingAssistant(null);
        Alert.alert(
          t("narra.chatFailedTitle", "Не удалось получить ответ"),
          reportNarraError("character_chat", error).message,
        );
      } finally {
        setSending(false);
      }
    },
    [
      append,
      book,
      bookId,
      character,
      characterId,
      conversation,
      messages,
      refreshMemory,
      sending,
      t,
      unlocked,
    ],
  );

  if (!book || !character) {
    return (
      <CenteredEmptyState
        title={t("narra.characterUnavailable", "Персонаж недоступен.")}
        style={styles.container}
      />
    );
  }

  if (!unlocked) {
    return (
      <CenteredEmptyState
        title={t("narra.characterLocked", "Персонаж ещё не открыт")}
        description={t(
          "narra.keepReading",
          "Продолжайте читать — герой появится позже по ходу книги.",
        )}
        style={styles.container}
      />
    );
  }

  const assistantMessageAction = speakingId
    ? undefined
    : {
        label: t("narra.playAnswer", "Озвучить ответ"),
        onPress: speak,
      };

  return (
    <View style={styles.container}>
      <NarraChat
        messages={chatMessages}
        adjustsForTransparentHeader
        floatingComposer
        isStreaming={sending || greetingLoading}
        showScrollToBottomButton={false}
        currentStep={sending || greetingLoading ? "responding" : "idle"}
        placeholder={
          interfaceLanguage === "en"
            ? t("narra.messagePlaceholder", "Message {{name}}…", { name: character.name })
            : character.chatPlaceholder ||
              t("narra.genericMessagePlaceholder", "Написать сообщение…")
        }
        onSend={send}
        assistantName={character.name}
        showTypingIndicator={false}
        showModeControls={false}
        assistantMessageAction={assistantMessageAction}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerAvatarButton: {
      width: headerControlSize,
      height: headerControlSize,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: headerControlSize / 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.elevation2,
    },
    headerAvatarPressed: { opacity: 0.62 },
    headerAvatarImage: { width: "100%", height: "100%" },
    headerTitleContent: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center",
      minWidth: 0,
    },
    headerTitlePressable: {
      alignItems: "center",
      alignSelf: "stretch",
      flex: 1,
      justifyContent: "center",
    },
    headerTitleGlass: {
      alignItems: "center",
      borderCurve: "continuous",
      borderRadius: radiusPixels.full,
      flexDirection: "column",
      flexShrink: 0,
      height: spacingPixels[44],
      justifyContent: "center",
      maxWidth: 220,
      minWidth: 104,
      paddingHorizontal: spacingPixels[12],
    },
    headerTitleFallback: {
      borderColor: colors.border,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: colors.elevation1,
    },
    headerTitle: {
      color: colors.foreground,
      ...bodyTypography,
      fontFamily: titleFontFamily,
      fontWeight: fontWeight.bold,
      maxWidth: 190,
    },
    headerSubtitle: {
      color: colors.mutedForeground,
      ...captionTypography,
      fontFamily: bodyTypography.fontFamily,
      textTransform: "none",
    },
  });

function CharacterHeaderTitle({
  name,
  status,
  isDark,
  onPress,
  styles,
}: {
  name: string;
  status: string;
  isDark: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const content = (
    <View style={styles.headerTitleContent}>
      <Text numberOfLines={1} style={styles.headerTitle}>
        {name}
      </Text>
      <Text numberOfLines={1} style={styles.headerSubtitle}>
        {status}
      </Text>
    </View>
  );

  if (Platform.OS === "ios" && isLiquidGlassAvailable()) {
    return (
      <GlassView
        colorScheme={isDark ? "dark" : "light"}
        glassEffectStyle="regular"
        isInteractive
        style={styles.headerTitleGlass}
      >
        <Pressable
          accessibilityLabel={`${name}, ${status}`}
          accessibilityRole="button"
          onPress={onPress}
          style={styles.headerTitlePressable}
        >
          {content}
        </Pressable>
      </GlassView>
    );
  }

  return (
    <Pressable
      accessibilityLabel={`${name}, ${status}`}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.headerTitleGlass, styles.headerTitleFallback]}
    >
      {content}
    </Pressable>
  );
}
