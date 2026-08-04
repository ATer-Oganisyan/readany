import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { reportNarraError } from "@/lib/narra/errors";
import { generateNarraSummary } from "@/lib/narra/summary";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useNarraStore } from "@/stores";
import { fontSize, fontWeight, spacing, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "NarraSummary">;

export function NarraSummaryScreen({ route }: Props) {
  const { bookId, chapter, excerpt, sourceKey } = route.params;
  const colors = useColors();
  const cachedSummary = useNarraStore((state) => state.books[bookId]?.summaries?.[sourceKey]);
  const setSummary = useNarraStore((state) => state.setSummary);
  const [summary, setLocalSummary] = useState(cachedSummary?.text ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const generate = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const text = await generateNarraSummary(chapter, excerpt);
      setLocalSummary(text);
      setSummary(bookId, { sourceKey, chapter, excerpt, text, generatedAt: Date.now() });
    } catch (cause) {
      setError(reportNarraError("selection_summary", cause).message);
    } finally {
      setLoading(false);
    }
  }, [bookId, chapter, excerpt, loading, setSummary, sourceKey]);

  useEffect(() => {
    if (startedRef.current || summary) return;
    startedRef.current = true;
    void generate();
  }, [generate, summary]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      style={{ backgroundColor: colors.background }}
    >
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>Фрагмент</Text>
        <Text selectable style={[styles.source, { color: colors.foreground }]}>
          {excerpt}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>Краткий пересказ</Text>
        {summary ? (
          <>
            <Text selectable style={[styles.result, { color: colors.foreground }]}>
              {summary}
            </Text>
            {loading ? (
              <View style={styles.status}>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.mutedForeground }}>Обновляем пересказ…</Text>
              </View>
            ) : null}
            {error ? (
              <Text selectable style={{ color: colors.mutedForeground }}>
                {error}
              </Text>
            ) : null}
          </>
        ) : loading ? (
          <View style={styles.status}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.mutedForeground }}>Составляем пересказ…</Text>
          </View>
        ) : (
          <Text selectable style={[styles.result, { color: colors.mutedForeground }]}>
            {error || "Не удалось составить пересказ."}
          </Text>
        )}
      </View>

      {summary || error ? (
        <NativeButton
          accessibilityLabel={summary ? "Составить пересказ заново" : "Попробовать снова"}
          disabled={loading}
          fullWidth
          icon="refresh"
          label={summary ? "Составить заново" : "Попробовать снова"}
          onPress={() => void generate()}
          variant={summary ? "secondary" : "primary"}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xxl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: 40,
  },
  section: { gap: spacing.sm },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    textTransform: "uppercase",
  },
  source: { fontSize: fontSize.base, lineHeight: 24 },
  result: { fontSize: fontSize.md, lineHeight: 28 },
  status: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 28 },
});
