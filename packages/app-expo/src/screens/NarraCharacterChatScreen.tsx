import { ChevronLeftIcon, SendIcon, Trash2Icon, Volume2Icon } from "@/components/ui/Icon";
import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { reportNarraError } from "@/lib/narra/errors";
import { synthesizeNarraSpeech } from "@/lib/narra/media";
import type { NarraCharacter, NarraChatMessage } from "@/lib/narra/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore, useNarraStore } from "@/stores";
import { radius, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Crypto from "expo-crypto";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<RootStackParamList, "NarraCharacterChat">;

function systemPrompt(character: NarraCharacter, title: string, progress: number, memory: string) {
  return `Ты — ${character.fullName} из книги «${title}». Полностью оставайся в роли.
Характер: ${character.traits.join(", ")}.
Роль: ${character.role}.
Манера речи: ${character.speechStyle}.
Отвечай от первого лица, живо, обычно 1–3 предложениями. Не говори, что ты ИИ, персонаж книги или модель.
Не используй списки и канцелярит. Реагируй на конкретные слова собеседника, можешь спорить, шутить и задавать вопросы.
Читатель прошёл ${Math.round(progress * 100)}% книги. Не раскрывай события дальше этой точки и не допускай спойлеров.
${memory ? `Твоя память о собеседнике:\n${memory}` : ""}`;
}

export function NarraCharacterChatScreen({ route, navigation }: Props) {
  const { bookId, characterId } = route.params;
  const colors = useColors();
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
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const canSend = Boolean(input.trim() && !sending && book && character);

  const conversation = useMemo(
    () =>
      character && book
        ? [
            {
              role: "system",
              content: systemPrompt(character, book.meta.title, book.progress, memory),
            },
            ...messages.slice(-18).map(({ role, content }) => ({ role, content })),
          ]
        : [],
    [book, character, memory, messages],
  );

  useEffect(
    () => () => {
      void soundRef.current?.unloadAsync();
      if (recording) void recording.stopAndUnloadAsync().catch(() => undefined);
    },
    [recording],
  );

  const refreshMemory = async (updatedMessages: NarraChatMessage[]) => {
    if (!book || !character || updatedMessages.length < 4 || updatedMessages.length % 4 !== 0) return;
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
                .map((item) => `${item.role === "user" ? "Читатель" : character.name}: ${item.content}`)
                .join("\n")}`,
            },
          ],
          temperature: 0.25,
          purpose: "memory",
          origin: "background",
          analytics_tier: "none",
        }),
      });
      const payload = (await response.json().catch(() => null)) as { text?: string } | null;
      if (response.ok && payload?.text?.trim()) setMemory(bookId, characterId, payload.text.trim());
    } catch {
      // Memory is an enhancement; a failed background refresh must not break the chat.
    }
  };

  const speak = async (message: NarraChatMessage) => {
    if (!character || speakingId) return;
    setSpeakingId(message.id);
    try {
      await soundRef.current?.unloadAsync();
      const uri = await synthesizeNarraSpeech(message.content, character.voice);
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setSpeakingId(null);
          void sound.unloadAsync();
          soundRef.current = null;
        }
      });
    } catch (error) {
      setSpeakingId(null);
      Alert.alert("Не удалось озвучить ответ", reportNarraError("character_speech", error).message);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      const active = recording;
      setRecording(null);
      try {
        await active.stopAndUnloadAsync();
        const uri = active.getURI();
        if (!uri) throw new Error("Запись не найдена");
        setSending(true);
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const binary = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const response = await narraGatewayRequest("/v2/speech/recognize", {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-audio-type": "audio/mp4",
          },
          body: binary,
        });
        const payload = (await response.json().catch(() => null)) as
          | { text?: string; error?: string }
          | null;
        if (!response.ok) throw new Error(payload?.error || "Не удалось распознать речь");
        setInput(payload?.text?.trim() || "");
      } catch (error) {
        Alert.alert("Ошибка диктовки", error instanceof Error ? error.message : String(error));
      } finally {
        setSending(false);
      }
      return;
    }
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Нужен доступ к микрофону", "Разрешите запись звука в настройках Android.");
      return;
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const created = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(created.recording);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !book || !character || sending) return;
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
      const payload = (await response.json().catch(() => null)) as
        | { text?: string; error?: string }
        | null;
      if (!response.ok) throw new Error(payload?.error || `Ошибка AI (${response.status})`);
      const assistantMessage: NarraChatMessage = {
        id: Crypto.randomUUID(),
        role: "assistant",
        content: payload?.text?.trim() || "Мне нечего добавить.",
        createdAt: Date.now(),
      };
      append(bookId, characterId, assistantMessage);
      void refreshMemory([...messages, userMessage, assistantMessage]);
    } catch (error) {
      Alert.alert("Не удалось получить ответ", reportNarraError("character_chat", error).message);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  if (!book || !character) return null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <ChevronLeftIcon color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.name, { color: colors.foreground }]}>{character.name}</Text>
          <Text style={[styles.status, { color: colors.emerald }]}>● в книге</Text>
        </View>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() =>
            Alert.alert("Очистить диалог?", "Память персонажа сохранится.", [
              { text: "Отмена", style: "cancel" },
              { text: "Очистить", style: "destructive", onPress: () => clear(bookId, characterId) },
            ])
          }
        >
          <Trash2Icon size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.length === 0 ? (
            <View style={[styles.greeting, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.greetingName, { color: colors.foreground }]}>
                {character.fullName}
              </Text>
              <Text style={[styles.greetingText, { color: colors.mutedForeground }]}>
                {character.greeting}
              </Text>
            </View>
          ) : null}
          {messages.map((message) => (
            <View key={message.id} style={message.role === "user" ? styles.userRow : styles.characterRow}>
              <View
                style={[
                  styles.bubble,
                  message.role === "user" ? styles.userBubble : styles.characterBubble,
                  {
                    backgroundColor: message.role === "user" ? colors.foreground : colors.card,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: message.role === "user" ? colors.background : colors.foreground,
                    fontSize: 15,
                    lineHeight: 22,
                  }}
                >
                  {message.content}
                </Text>
              </View>
              {message.role === "assistant" ? (
                <TouchableOpacity style={styles.speak} onPress={() => void speak(message)}>
                  {speakingId === message.id ? (
                    <ActivityIndicator size="small" color={colors.indigo} />
                  ) : (
                    <Volume2Icon size={17} color={colors.mutedForeground} />
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
          {sending ? <ActivityIndicator style={{ margin: 16 }} color={colors.indigo} /> : null}
        </ScrollView>

        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={`Написать ${character.name}…`}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
          />
          <TouchableOpacity
            style={[
              styles.voice,
              {
                backgroundColor: recording ? colors.destructive : colors.card,
                borderColor: colors.border,
              },
            ]}
            disabled={sending}
            onPress={() => void toggleRecording()}
          >
            <Text style={{ fontSize: 18 }}>{recording ? "■" : "🎙"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.send, { backgroundColor: canSend ? colors.foreground : colors.muted }]}
            disabled={!canSend}
            onPress={() => void send()}
          >
            <SendIcon size={19} color={canSend ? colors.background : colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: { minHeight: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, alignItems: "center" },
  name: { fontSize: 17, fontWeight: "700" },
  status: { fontSize: 11, marginTop: 2 },
  messages: { padding: 16, paddingBottom: 28 },
  greeting: { borderWidth: 1, borderRadius: radius.xl, padding: 20, marginVertical: 24 },
  greetingName: { fontSize: 19, fontWeight: "800", marginBottom: 8 },
  greetingText: { fontSize: 15, lineHeight: 22 },
  userRow: { alignSelf: "flex-end", maxWidth: "86%" },
  characterRow: { alignSelf: "flex-start", maxWidth: "92%", flexDirection: "row", alignItems: "flex-end" },
  bubble: { maxWidth: "86%", borderRadius: 20, paddingHorizontal: 15, paddingVertical: 11, marginBottom: 9, borderWidth: StyleSheet.hairlineWidth },
  userBubble: { maxWidth: "100%", borderBottomRightRadius: 6 },
  characterBubble: { maxWidth: "90%", borderBottomLeftRadius: 6 },
  speak: { width: 34, height: 34, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  composer: { flexDirection: "row", alignItems: "flex-end", padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, fontSize: 15 },
  voice: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", marginLeft: 8 },
});
