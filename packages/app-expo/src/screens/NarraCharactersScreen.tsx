import { NarraLogo } from "@/components/NarraLogo";
import { type ExtractorRef, ExtractorWebView } from "@/components/rag/ExtractorWebView";
import { ChevronLeftIcon, MessageSquareIcon, SparklesIcon } from "@/components/ui/Icon";
import { analyzeBookCharacters } from "@/lib/narra/character-analysis";
import { reportNarraError } from "@/lib/narra/errors";
import { generateCharacterPortrait } from "@/lib/narra/media";
import { inspectMobileBookForVectorize } from "@/lib/rag/auto-vectorize-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore, useNarraStore } from "@/stores";
import { radius, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system/legacy";
import { useMemo, useRef, useState } from "react";
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

type Props = NativeStackScreenProps<RootStackParamList, "NarraCharacters">;

export function NarraCharactersScreen({ route, navigation }: Props) {
  const { bookId } = route.params;
  const colors = useColors();
  const book = useLibraryStore((state) => state.books.find((item) => item.id === bookId));
  const bookState = useNarraStore((state) => state.books[bookId]);
  const analyzing = useNarraStore((state) => state.analyzingBookId === bookId);
  const updateCharacter = useNarraStore((state) => state.updateCharacter);
  const [portraitLoading, setPortraitLoading] = useState<string | null>(null);
  const [analysisStage, setAnalysisStage] = useState("");
  const extractorRef = useRef<ExtractorRef>(null);
  const characters = bookState?.characters ?? [];
  const busy = analyzing || Boolean(analysisStage);
  const unlocked = useMemo(
    () => characters.filter((character) => (book?.progress ?? 0) >= character.unlockProgress),
    [book?.progress, characters],
  );

  const analyze = async () => {
    if (!book) return;
    try {
      setAnalysisStage("Извлекаю текст…");
      const info = await inspectMobileBookForVectorize(book);
      let extractedText = "";
      if (info.canVectorize && info.mimeType && extractorRef.current) {
        const base64 = await FileSystem.readAsStringAsync(info.absPath, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const chapters = await extractorRef.current.extractChapters(base64, info.mimeType);
        extractedText = chapters
          .map((chapter) => `${chapter.title || ""}\n${chapter.content || ""}`)
          .join("\n\n");
      }
      setAnalysisStage("Ищу героев…");
      await analyzeBookCharacters(book, extractedText);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Narra не смогла выполнить запрос. Попробуйте ещё раз.";
      Alert.alert("Не удалось найти персонажей", message, [
        { text: "Отмена", style: "cancel" },
        { text: "Повторить", onPress: () => void analyze() },
      ]);
    } finally {
      setAnalysisStage("");
    }
  };

  const createPortrait = async (character: (typeof characters)[number]) => {
    setPortraitLoading(character.id);
    try {
      const portraitUri = await generateCharacterPortrait(bookId, character);
      updateCharacter(bookId, character.id, { portraitUri });
    } catch (error) {
      const normalized = reportNarraError("character_portrait", error);
      Alert.alert("Не удалось создать портрет", normalized.message, [
        { text: "Отмена", style: "cancel" },
        { text: "Повторить", onPress: () => void createPortrait(character) },
      ]);
    } finally {
      setPortraitLoading(null);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <ExtractorWebView ref={extractorRef} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <ChevronLeftIcon color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>ЖИВЫЕ КНИГИ</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Персонажи</Text>
        </View>
        <NarraLogo size={38} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.bookTitle, { color: colors.foreground }]}>{book?.meta.title}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Герои открываются по мере чтения и помнят ваши разговоры.
        </Text>

        {characters.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SparklesIcon size={34} color={colors.indigo} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              Познакомиться с героями
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Narra проанализирует текст, найдёт главных персонажей, их характеры и манеру речи.
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={() => void analyze()}
              disabled={busy}
            >
              {busy ? (
                <View style={styles.analyzingRow}>
                  <ActivityIndicator color={colors.primaryForeground} />
                  <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
                    {analysisStage || "Ищу героев…"}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
                  Найти персонажей
                </Text>
              )}
            </TouchableOpacity>
            {bookState?.analysisError ? (
              <Text style={[styles.error, { color: colors.destructive }]}>
                {bookState.analysisError}
              </Text>
            ) : null}
          </View>
        ) : (
          <>
            {characters.map((character) => {
              const isUnlocked = unlocked.some((item) => item.id === character.id);
              return (
                <TouchableOpacity
                  key={character.id}
                  style={[
                    styles.card,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    !isUnlocked && styles.locked,
                  ]}
                  disabled={!isUnlocked}
                  onPress={() =>
                    navigation.navigate("NarraCharacterChat", {
                      bookId,
                      characterId: character.id,
                    })
                  }
                >
                  <TouchableOpacity
                    style={[styles.avatar, { backgroundColor: colors.foreground }]}
                    disabled={!isUnlocked || portraitLoading === character.id}
                    onPress={(event) => {
                      event.stopPropagation();
                      void createPortrait(character);
                    }}
                  >
                    {character.portraitUri ? (
                      <Image source={{ uri: character.portraitUri }} style={styles.avatarImage} />
                    ) : portraitLoading === character.id ? (
                      <ActivityIndicator color={colors.background} />
                    ) : (
                      <Text style={[styles.avatarText, { color: colors.background }]}>
                        {character.name.slice(0, 1).toUpperCase()}
                      </Text>
                    )}
                  </TouchableOpacity>
                  <View style={styles.cardCopy}>
                    <Text style={[styles.characterName, { color: colors.foreground }]}>
                      {isUnlocked ? character.fullName : "Неизвестный герой"}
                    </Text>
                    <Text style={[styles.role, { color: colors.mutedForeground }]}>
                      {isUnlocked
                        ? character.role
                        : `Откроется после ${Math.round(character.unlockProgress * 100)}% книги`}
                    </Text>
                    {isUnlocked && character.traits.length > 0 ? (
                      <Text style={[styles.traits, { color: colors.mutedForeground }]}>
                        {character.traits.join(" · ")}
                      </Text>
                    ) : null}
                    {isUnlocked ? (
                      <View style={styles.characterActions}>
                        <TouchableOpacity
                          style={[styles.characterAction, { borderColor: colors.border }]}
                          onPress={(event) => {
                            event.stopPropagation();
                            void createPortrait(character);
                          }}
                        >
                          <Text style={[styles.characterActionText, { color: colors.foreground }]}>
                            {character.portraitUri ? "Обновить портрет" : "Создать портрет"}
                          </Text>
                        </TouchableOpacity>
                        <View style={[styles.characterAction, { backgroundColor: colors.primary }]}>
                          <Text
                            style={[
                              styles.characterActionText,
                              { color: colors.primaryForeground },
                            ]}
                          >
                            Голосовой чат
                          </Text>
                        </View>
                      </View>
                    ) : null}
                  </View>
                  {isUnlocked ? <MessageSquareIcon size={20} color={colors.indigo} /> : null}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.refreshButton} onPress={() => void analyze()}>
              <Text style={{ color: colors.mutedForeground }}>Проанализировать заново</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 64,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" },
  headerTitle: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 1.4 },
  title: { fontSize: 23, fontWeight: "800", letterSpacing: -0.5 },
  content: { padding: 20, paddingBottom: 48 },
  bookTitle: { fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: -0.8 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 24 },
  empty: { padding: 24, borderWidth: 1, borderRadius: radius.xxl, alignItems: "center" },
  emptyTitle: { fontSize: 20, fontWeight: "700", marginTop: 14 },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 8 },
  primaryButton: { borderRadius: 999, minHeight: 48, paddingHorizontal: 24, marginTop: 22, justifyContent: "center" },
  primaryText: { fontSize: 15, fontWeight: "700" },
  analyzingRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  error: { fontSize: 13, lineHeight: 18, textAlign: "center", marginTop: 14 },
  card: {
    minHeight: 128,
    padding: 16,
    borderWidth: 1,
    borderRadius: radius.xl,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  locked: { opacity: 0.48 },
  avatar: { width: 58, height: 58, borderRadius: 18, alignItems: "center", justifyContent: "center", marginRight: 14 },
  avatarText: { fontSize: 24, fontWeight: "800" },
  avatarImage: { width: "100%", height: "100%", borderRadius: 18 },
  cardCopy: { flex: 1, marginRight: 10 },
  characterName: { fontSize: 17, fontWeight: "700" },
  role: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  traits: { fontSize: 12, lineHeight: 17, marginTop: 5 },
  characterActions: { flexDirection: "row", gap: 7, marginTop: 10, flexWrap: "wrap" },
  characterAction: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  characterActionText: { fontSize: 11, fontWeight: "700" },
  refreshButton: { alignSelf: "center", padding: 16 },
});
