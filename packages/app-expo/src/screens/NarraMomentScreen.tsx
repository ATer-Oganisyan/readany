import { ChevronLeftIcon, SparklesIcon } from "@/components/ui/Icon";
import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { generateSceneImage } from "@/lib/narra/media";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useNarraStore } from "@/stores";
import { radius, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
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
  const [summary, setLocalSummary] = useState(cachedSummary || "");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [busy, setBusy] = useState<"summary" | "image" | null>(null);

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
      Alert.alert("Не удалось сделать саммари", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const createImage = async () => {
    setBusy("image");
    try {
      setImageUri(await generateSceneImage(bookId, chapter, excerpt));
    } catch (error) {
      Alert.alert("Не удалось создать сцену", error instanceof Error ? error.message : String(error));
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
  result: { borderWidth: 1, borderRadius: radius.xl, padding: 20, marginBottom: 18 },
  resultTitle: { fontSize: 17, fontWeight: "800", marginBottom: 8 },
  resultText: { fontSize: 15, lineHeight: 23 },
  image: { width: "100%", aspectRatio: 1, borderRadius: radius.xxl, backgroundColor: "#111" },
});
