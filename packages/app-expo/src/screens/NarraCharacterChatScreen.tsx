import { Trash2Icon, Volume2Icon } from "@/components/ui/Icon";
import { Text, TextInput } from "@/components/ui/Typography";
import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { NarraAudioPlayer } from "@/lib/narra/audio-player";
import { isCharacterUnlocked, normalizeReadingProgress } from "@/lib/narra/domain";
import { reportNarraError } from "@/lib/narra/errors";
import { synthesizeNarraSpeech } from "@/lib/narra/media";
import type { NarraCharacter, NarraChatMessage } from "@/lib/narra/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore, useNarraStore } from "@/stores";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  useColors,
  withOpacity,
} from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";

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

export function NarraCharacterChatScreen({ route, navigation }: Props) {
  const { bookId, characterId } = route.params;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const book = useLibraryStore((state) => state.books.find((item) => item.id === bookId));
  const narraBook = useNarraStore((state) => state.books[bookId]);
  const append = useNarraStore((state) => state.appendChatMessage);
  const clear = useNarraStore((state) => state.clearChat);
  const setMemory = useNarraStore((state) => state.setMemory);
  const character = narraBook?.characters.find((item) => item.id === characterId);
  const messages = narraBook?.chats?.[characterId] ?? [];
  const memory = narraBook?.memories?.[characterId] ?? "";
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const audioRef = useRef(new NarraAudioPlayer());
  const unlocked = Boolean(book && character && isCharacterUnlocked(book.progress, character));

  const clearConversation = useCallback(() => {
    Alert.alert(
      t("narra.clearChatTitle", "Очистить диалог?"),
      t("narra.memoryWillRemain", "Память персонажа сохранится."),
      [
        { text: t("common.cancel", "Отмена"), style: "cancel" },
        {
          text: t("narra.clear", "Очистить"),
          style: "destructive",
          onPress: () => clear(bookId, characterId),
        },
      ],
    );
  }, [bookId, characterId, clear, t]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: character?.name || t("narra.characterChat", "Чат с персонажем"),
      headerRight: character
        ? () => (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t("narra.clear", "Очистить")}
              onPress={clearConversation}
              style={styles.headerButton}
            >
              <Trash2Icon size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [character, clearConversation, colors.mutedForeground, navigation, styles.headerButton, t]);

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
    async (message: NarraChatMessage) => {
      if (!character || speakingId) return;
      setSpeakingId(message.id);
      try {
        const uri = await synthesizeNarraSpeech(message.content, character.voice);
        audioRef.current.play(uri, () => setSpeakingId(null));
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

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !book || !character || !unlocked || sending) return;
    setInput("");
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
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [
    append,
    book,
    bookId,
    character,
    characterId,
    conversation,
    input,
    messages,
    refreshMemory,
    sending,
    t,
    unlocked,
  ]);

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

  const canSend = Boolean(input.trim() && !sending);
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={88}
    >
      <ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.messages}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {messages.length === 0 ? (
          <View style={styles.greeting}>
            <Text style={styles.greetingText}>{character.greeting}</Text>
          </View>
        ) : null}
        {messages.map((message) => (
          <View
            key={message.id}
            style={message.role === "user" ? styles.userRow : styles.characterRow}
          >
            <View
              style={[
                styles.bubble,
                message.role === "user" ? styles.userBubble : styles.characterBubble,
              ]}
            >
              <Text style={message.role === "user" ? styles.userMessage : styles.characterMessage}>
                {message.content}
              </Text>
            </View>
            {message.role === "assistant" ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t("narra.playAnswer", "Озвучить ответ")}
                disabled={Boolean(speakingId)}
                onPress={() => void speak(message)}
                style={styles.speakButton}
              >
                {speakingId === message.id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Volume2Icon size={17} color={colors.mutedForeground} />
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {sending ? <ActivityIndicator style={styles.loading} color={colors.primary} /> : null}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={t("narra.messagePlaceholder", "Написать {{name}}…", {
            name: character.name,
          })}
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={styles.input}
        />
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.82}
          disabled={!canSend}
          onPress={() => void send()}
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Text style={styles.sendButtonText}>{t("narra.send", "Отправить")}</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    messages: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
    greeting: {
      alignSelf: "flex-start",
      maxWidth: "88%",
      padding: spacing.lg,
      borderRadius: radius.card,
      backgroundColor: colors.card,
    },
    greetingText: { color: colors.foreground, fontSize: fontSize.sm, lineHeight: 21 },
    userRow: { alignSelf: "flex-end", maxWidth: "86%" },
    characterRow: {
      alignSelf: "flex-start",
      maxWidth: "94%",
      flexDirection: "row",
      alignItems: "flex-end",
    },
    bubble: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 20 },
    userBubble: { backgroundColor: colors.primary, borderBottomRightRadius: radius.sm },
    characterBubble: {
      maxWidth: "90%",
      backgroundColor: colors.card,
      borderBottomLeftRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    userMessage: { color: colors.primaryForeground, fontSize: fontSize.sm, lineHeight: 21 },
    characterMessage: { color: colors.foreground, fontSize: fontSize.sm, lineHeight: 21 },
    speakButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
    loading: { margin: spacing.lg },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.sm,
      padding: spacing.md,
      paddingBottom: spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: withOpacity(colors.background, 0.96),
    },
    input: {
      flex: 1,
      minHeight: 46,
      maxHeight: 120,
      paddingHorizontal: spacing.lg,
      paddingTop: 12,
      paddingBottom: 10,
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.card,
      color: colors.foreground,
      fontSize: fontSize.sm,
    },
    sendButton: {
      minHeight: 46,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    sendButtonDisabled: { opacity: 0.42 },
    sendButtonText: {
      color: colors.primaryForeground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
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
  });
