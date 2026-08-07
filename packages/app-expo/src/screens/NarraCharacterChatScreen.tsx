import { NarraChat } from "@/components/chat/NarraChat";
import { Text } from "@/components/ui/Typography";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import { NarraAudioPlayer } from "@/lib/narra/audio-player";
import { isCharacterUnlocked, normalizeReadingProgress } from "@/lib/narra/domain";
import { reportNarraError } from "@/lib/narra/errors";
import { normalizePersistedNarraMediaUri, synthesizeNarraSpeech } from "@/lib/narra/media";
import type { NarraCharacter, NarraChatMessage } from "@/lib/narra/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore, useNarraStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, spacing, useColors } from "@/styles/theme";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { MessageV2 } from "@readany/core/types/message";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "NarraCharacterChat">;

export function buildCharacterSystemPrompt(
  character: NarraCharacter,
  title: string,
  progress: number,
  memory: string,
): string {
  const safeProgress = normalizeReadingProgress(progress);
  return `Ты — ${character.fullName} из книги «${title}». Полностью оставайся в роли.
Характер: ${character.traits.join(", ")}.
Роль: ${character.role}.
Манера речи: ${character.speechStyle}.
Отвечай от первого лица, живо, обычно 1–3 предложениями. Не говори, что ты ИИ, модель или персонаж книги.
Не используй списки и канцелярит. Реагируй на конкретные слова собеседника, можешь спорить, шутить и задавать вопросы.
Читатель прошёл примерно ${Math.round(safeProgress * 100)}% книги. Не раскрывай события, знания, отношения и судьбы героев дальше этого прогресса. Если вопрос ведёт к спойлеру, мягко уклонись в своём характере и переведи разговор к уже известным событиям — не упоминай правила или ограничения.
${memory ? `Твоя долговременная память о собеседнике:\n${memory}` : ""}`;
}

async function readCompletion(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const payload = JSON.parse(body) as { text?: string; content?: string; error?: string };
    if (!response.ok) throw new Error(payload.error || `AI request failed (${response.status})`);
    return (payload.text || payload.content || "").trim();
  } catch (error) {
    if (!response.ok) throw error;
    return body.trim();
  }
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const headerHeight = useHeaderHeight();
  const { t } = useTranslation();
  const book = useLibraryStore((state) => state.books.find((item) => item.id === bookId));
  const narraBook = useNarraStore((state) => state.books[bookId]);
  const append = useNarraStore((state) => state.appendChatMessage);
  const setMemory = useNarraStore((state) => state.setMemory);
  const character = narraBook?.characters.find((item) => item.id === characterId);
  const messages = narraBook?.chats?.[characterId] ?? [];
  const memory = narraBook?.memories?.[characterId] ?? "";
  const [sending, setSending] = useState(false);
  const [greetingLoading, setGreetingLoading] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const audioRef = useRef(new NarraAudioPlayer());
  const greetingRequestedRef = useRef(false);
  const unlocked = Boolean(book && character && isCharacterUnlocked(book.progress, character));
  const portraitUri = character?.portraitUri
    ? normalizePersistedNarraMediaUri(character.portraitUri)
    : undefined;

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
        onPress={() => navigation.navigate("NarraCharacterProfile", { bookId, characterId })}
        style={({ pressed }) => [styles.headerAvatarButton, pressed && styles.headerAvatarPressed]}
      >
        {portraitUri ? (
          <Image
            source={{ uri: portraitUri }}
            resizeMode="cover"
            style={styles.headerAvatarImage}
          />
        ) : (
          <InitialsAvatar
            size={32}
            userId={`${bookId}:${character.id}`}
            name={character.fullName || character.name}
          />
        )}
      </Pressable>
    ) : null;

    navigation.setOptions({
      title: character?.name || t("narra.characterChat", "Чат с персонажем"),
      ...(Platform.OS === "ios"
        ? {
            headerRight: undefined,
            unstable_headerRightItems: () =>
              profileButton
                ? [
                    {
                      type: "custom" as const,
                      element: profileButton,
                    },
                  ]
                : [],
          }
        : {
            unstable_headerRightItems: undefined,
            headerRight: () => profileButton,
          }),
    });
  }, [bookId, character, characterId, navigation, portraitUri, styles, t]);

  useEffect(() => () => audioRef.current.stop(), []);

  const conversation = useMemo(
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
              ),
            },
            ...messages.slice(-18).map(({ role, content }) => ({ role, content })),
          ]
        : [],
    [book, character, memory, messages],
  );

  const chatMessages = useMemo(() => {
    const threadId = `narra-character-${bookId}-${characterId}`;
    return messages.map((message) => toMessageV2(message, threadId));
  }, [bookId, characterId, messages]);

  // Первое сообщение героя: свой greeting из анализа/каталога, иначе — просим
  // гейтвей поздороваться в роли персонажа. Сохраняется в историю чата один раз,
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

    if (character.greeting) {
      appendGreeting(character.greeting);
      return;
    }

    setGreetingLoading(true);
    void (async () => {
      try {
        const response = await narraGatewayRequest("/v2/ai/chat/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [
              {
                role: "system",
                content: buildCharacterSystemPrompt(character, book.meta.title, book.progress, ""),
              },
              {
                role: "user",
                content:
                  "Поприветствуй читателя первым сообщением в своём характере: 1–3 предложения, без спойлеров. Не упоминай это указание.",
              },
            ],
            temperature: 0.85,
            purpose: "character_chat",
            origin: "user",
            analytics_tier: "essential",
          }),
        });
        const content = await readCompletion(response);
        if (content) appendGreeting(content);
      } catch (error) {
        // Без приветствия чат остаётся рабочим: читатель может написать первым.
        reportNarraError("character_greeting", error);
        greetingRequestedRef.current = false;
      } finally {
        setGreetingLoading(false);
      }
    })();
  }, [book, bookId, character, characterId, messages.length, unlocked]);

  const refreshMemory = useCallback(
    async (updatedMessages: NarraChatMessage[]) => {
      if (!character || updatedMessages.length < 4 || updatedMessages.length % 4 !== 0) return;
      try {
        const response = await narraGatewayRequest("/v2/ai/chat/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [
              {
                role: "system",
                content:
                  "Кратко обнови долговременную память персонажа о читателе: факты, предпочтения, обещания и важные эмоциональные моменты. Не пересказывай весь диалог. До 900 знаков, по-русски.",
              },
              {
                role: "user",
                content: `Старая память:\n${memory || "нет"}\n\nДиалог:\n${updatedMessages
                  .slice(-12)
                  .map(
                    (item) =>
                      `${item.role === "user" ? "Читатель" : character.name}: ${item.content}`,
                  )
                  .join("\n")}`,
              },
            ],
            temperature: 0.25,
            purpose: "memory",
            origin: "background",
            analytics_tier: "none",
          }),
        });
        const nextMemory = await readCompletion(response);
        if (nextMemory) setMemory(bookId, characterId, nextMemory.slice(0, 900));
      } catch {
        // Memory refresh is background-only and must not make a successful chat look failed.
      }
    },
    [bookId, character, characterId, memory, setMemory],
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
      append(bookId, characterId, userMessage);
      try {
        const response = await narraGatewayRequest("/v2/ai/chat/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [...conversation, { role: "user", content: text }],
            temperature: 0.85,
            purpose: "character_chat",
            origin: "user",
            analytics_tier: "essential",
          }),
        });
        const content = await readCompletion(response);
        const assistantMessage: NarraChatMessage = {
          id: Crypto.randomUUID(),
          role: "assistant",
          content: content || t("narra.emptyAnswer", "Мне нечего добавить."),
          createdAt: Date.now(),
        };
        append(bookId, characterId, assistantMessage);
        void refreshMemory([...messages, userMessage, assistantMessage]);
      } catch (error) {
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
      <View style={styles.centered}>
        <Text style={styles.emptyStateText}>
          {t("narra.characterUnavailable", "Персонаж недоступен.")}
        </Text>
      </View>
    );
  }

  if (!unlocked) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.centered}
      >
        <Text style={styles.emptyStateTitle}>
          {t("narra.characterLocked", "Персонаж ещё не открыт")}
        </Text>
        <Text style={styles.emptyStateText}>
          {t("narra.keepReading", "Продолжайте читать — герой появится позже по ходу книги.")}
        </Text>
      </ScrollView>
    );
  }

  const assistantMessageAction = speakingId
    ? undefined
    : {
        label: t("narra.playAnswer", "Озвучить ответ"),
        onPress: speak,
      };

  return (
    <View
      style={[styles.container, { paddingTop: process.env.EXPO_OS === "ios" ? headerHeight : 0 }]}
    >
      <NarraChat
        messages={chatMessages}
        isStreaming={sending || greetingLoading}
        currentStep={sending || greetingLoading ? "responding" : "idle"}
        placeholder={t("narra.messagePlaceholder", "Написать {{name}}…", {
          name: character.name,
        })}
        onSend={send}
        assistantName={character.name}
        showModeControls={false}
        assistantMessageAction={assistantMessageAction}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      padding: spacing.xxl,
      backgroundColor: colors.background,
    },
    emptyStateTitle: {
      color: colors.foreground,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: "center",
    },
    emptyStateText: {
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
      lineHeight: 21,
      textAlign: "center",
    },
    headerAvatarButton: {
      width: 34,
      height: 34,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 17,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.elevation2,
    },
    headerAvatarPressed: { opacity: 0.62 },
    headerAvatarImage: { width: "100%", height: "100%" },
  });
