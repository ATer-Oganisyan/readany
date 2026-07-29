import { ChevronLeftIcon, SparklesIcon } from "@/components/ui/Icon";
import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { reportNarraError } from "@/lib/narra/errors";
import { generateSceneImage } from "@/lib/narra/media";
import { synthesizeNarraSpeech } from "@/lib/narra/media";
import type { NarraScenarioSegment } from "@/lib/narra/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useNarraStore } from "@/stores";
import { radius, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Audio } from "expo-av";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<RootStackParamList, "NarraMoment">;

export function NarraMomentScreen({ route, navigation }: Props) {
  const { bookId, chapter, excerpt } = route.params;
  const colors = useColors();
  const cachedSummary = useNarraStore((state) => state.books[bookId]?.summaries[chapter]);
  const setSummary = useNarraStore((state) => state.setSummary);
  const characters = useNarraStore((state) => state.books[bookId]?.characters ?? []);
  const [summary, setLocalSummary] = useState(cachedSummary || "");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [busy, setBusy] = useState<"summary" | "image" | "audio" | null>(null);
  const [audioProgress, setAudioProgress] = useState("");
  const cancelledRef = useRef(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      void soundRef.current?.unloadAsync();
    },
    [],
  );

  const extractScenario = (value: string): NarraScenarioSegment[] => {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || value;
    const start = fenced.indexOf("[");
    const end = fenced.lastIndexOf("]");
    if (start < 0 || end <= start) throw new Error("AI не вернул сценарий озвучки");
    const raw = JSON.parse(fenced.slice(start, end + 1)) as Array<Record<string, unknown>>;
    return raw
      .filter((item) => typeof item.text === "string" && item.text.trim())
      .map((item) => ({
        type: item.type === "speech" ? "speech" : "narration",
        characterId: item.character ? String(item.character) : null,
        emotion: (item.emotion || "neutral") as NarraScenarioSegment["emotion"],
        text: String(item.text),
      }));
  };

  const playSound = async (uri: string) =>
    new Promise<void>(async (resolve, reject) => {
      try {
        const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            void sound.unloadAsync();
            soundRef.current = null;
            resolve();
          }
        });
      } catch (error) {
        reject(error);
      }
    });

  const toggleAudio = async () => {
    if (busy === "audio") {
      cancelledRef.current = true;
      await soundRef.current?.unloadAsync();
      soundRef.current = null;
      setBusy(null);
      setAudioProgress("");
      return;
    }
    setBusy("audio");
    cancelledRef.current = false;
    try {
      const roster = characters.map((item) => `${item.id} = ${item.name}`).join("; ");
      const response = await narraGatewayRequest("/v2/ai/chat/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                `Разбей текст на сценарий аудиокниги. Верни только JSON-массив ` +
                `[{"type":"narration|speech","character":"id|null","emotion":"neutral|joy|tenderness|anger|fear|irony|sadness","text":"дословный текст"}]. ` +
                `Сохрани весь текст и порядок. Персонажи: ${roster || "не определены"}.`,
            },
            { role: "user", content: excerpt.slice(0, 12_000) },
          ],
          temperature: 0.15,
          purpose: "structured_task",
          origin: "user",
          analytics_tier: "essential",
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { text?: string; error?: string }
        | null;
      if (!response.ok) throw new Error(payload?.error || `Ошибка AI (${response.status})`);
      const scenario = extractScenario(payload?.text || "");
      for (let index = 0; index < scenario.length; index += 1) {
        if (cancelledRef.current) break;
        const segment = scenario[index];
        const character = characters.find((item) => item.id === segment.characterId);
        setAudioProgress(`${character?.name || "Рассказчик"} · ${index + 1}/${scenario.length}`);
        const uri = await synthesizeNarraSpeech(segment.text, character?.voice || "Nec");
        if (!cancelledRef.current) await playSound(uri);
      }
    } catch (error) {
      if (!cancelledRef.current) {
        Alert.alert("Не удалось озвучить сцену", reportNarraError("scene_speech", error).message);
      }
    } finally {
      setBusy(null);
      setAudioProgress("");
    }
  };

  const createSummary = async () => {
    setBusy("summary");
    try {
      const response = await narraGatewayRequest("/v2/ai/chat/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "Составь ясное саммари показанного фрагмента книги в 3–5 предложениях. Сохрани важные события, детали и эмоциональный смысл. Только саммари, по-русски.",
            },
            { role: "user", content: `Глава «${chapter}»:\n${excerpt.slice(0, 30000)}` },
          ],
          temperature: 0.35,
          purpose: "summary",
          origin: "user",
          analytics_tier: "essential",
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { text?: string; error?: string }
        | null;
      if (!response.ok) throw new Error(payload?.error || `Ошибка AI (${response.status})`);
      const value = payload?.text?.trim() || "";
      setLocalSummary(value);
      setSummary(bookId, chapter, value);
    } catch (error) {
      Alert.alert("Не удалось сделать саммари", reportNarraError("scene_summary", error).message);
    } finally {
      setBusy(null);
    }
  };

  const createImage = async () => {
    setBusy("image");
    try {
      setImageUri(await generateSceneImage(bookId, chapter, excerpt));
    } catch (error) {
      Alert.alert("Не удалось создать сцену", reportNarraError("scene_image", error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
          <ChevronLeftIcon color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>МОМЕНТ ЧТЕНИЯ</Text>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {chapter || "Текущая страница"}
          </Text>
        </View>
        <SparklesIcon color={colors.indigo} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.quote, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.quoteText, { color: colors.mutedForeground }]} numberOfLines={8}>
            {excerpt}
          </Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.action, { backgroundColor: colors.foreground }]}
            disabled={Boolean(busy)}
            onPress={() => void createSummary()}
          >
            {busy === "summary" ? <ActivityIndicator color={colors.background} /> : (
              <Text style={[styles.actionText, { color: colors.background }]}>✦ Саммари</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.action, { backgroundColor: colors.primary }]}
            disabled={Boolean(busy)}
            onPress={() => void createImage()}
          >
            {busy === "image" ? <ActivityIndicator color={colors.primaryForeground} /> : (
              <Text style={[styles.actionText, { color: colors.primaryForeground }]}>Создать сцену</Text>
            )}
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.audioAction, { borderColor: colors.border, backgroundColor: colors.card }]}
          disabled={Boolean(busy && busy !== "audio")}
          onPress={() => void toggleAudio()}
        >
          {busy === "audio" ? <ActivityIndicator color={colors.indigo} /> : null}
          <Text style={[styles.audioText, { color: colors.foreground }]}>
            {busy === "audio" ? `Остановить · ${audioProgress}` : "▶ Озвучить по ролям"}
          </Text>
        </TouchableOpacity>
        {summary ? (
          <View style={[styles.result, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.resultTitle, { color: colors.foreground }]}>Коротко о прочитанном</Text>
            <Text style={[styles.resultText, { color: colors.foreground }]}>{summary}</Text>
          </View>
        ) : null}
        {imageUri ? <Image source={{ uri: imageUri }} style={styles.image} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 64, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 44, height: 44, justifyContent: "center" },
  eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 1.3 },
  title: { fontSize: 20, fontWeight: "800", marginTop: 1 },
  content: { padding: 20, paddingBottom: 48 },
  quote: { borderWidth: 1, borderRadius: radius.xl, padding: 18 },
  quoteText: { fontSize: 14, lineHeight: 22, fontStyle: "italic" },
  actions: { flexDirection: "row", gap: 10, marginVertical: 18 },
  action: { flex: 1, minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  actionText: { fontSize: 14, fontWeight: "700" },
  audioAction: { minHeight: 50, borderWidth: 1, borderRadius: 999, flexDirection: "row", gap: 9, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  audioText: { fontSize: 14, fontWeight: "700" },
  result: { borderWidth: 1, borderRadius: radius.xl, padding: 20, marginBottom: 18 },
  resultTitle: { fontSize: 17, fontWeight: "800", marginBottom: 8 },
  resultText: { fontSize: 15, lineHeight: 23 },
  image: { width: "100%", aspectRatio: 1, borderRadius: radius.xxl, backgroundColor: "#111" },
});
