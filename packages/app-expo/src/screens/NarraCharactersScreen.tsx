import { type ExtractorRef, ExtractorWebView } from "@/components/rag/ExtractorWebView";
import { ChevronRightIcon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import { CenteredEmptyState } from "@/components/ui/centered-empty-state";
import { analyzeBookCharacters } from "@/lib/narra/character-analysis";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import { reportNarraError } from "@/lib/narra/errors";
import { generateCharacterPortrait, normalizePersistedNarraMediaUri } from "@/lib/narra/media";
import { inspectMobileBookForVectorize } from "@/lib/rag/auto-vectorize-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore, useNarraStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "NarraCharacters">;

export function NarraCharactersScreen({ route, navigation }: Props) {
  const { bookId } = route.params;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const book = useLibraryStore((state) => state.books.find((item) => item.id === bookId));
  const bookState = useNarraStore((state) => state.books[bookId]);
  const analyzing = useNarraStore((state) => state.analyzingBookId === bookId);
  const updateCharacter = useNarraStore((state) => state.updateCharacter);
  const extractorRef = useRef<ExtractorRef>(null);
  const analysisActiveRef = useRef(false);
  const portraitAttemptsRef = useRef(new Set<string>());
  const validatedPortraitsRef = useRef(new Set<string>());
  const validatedBookIdRef = useRef(bookId);
  const [analysisStage, setAnalysisStage] = useState("");
  const [portraitLoading, setPortraitLoading] = useState<string | null>(null);
  const characters = bookState?.characters ?? [];
  const busy = analyzing || Boolean(analysisStage);

  useEffect(() => {
    let cancelled = false;
    if (validatedBookIdRef.current !== bookId) {
      validatedBookIdRef.current = bookId;
      validatedPortraitsRef.current.clear();
    }
    for (const character of characters) {
      const persistedUri = character.portraitUri;
      if (!persistedUri?.startsWith("file://")) continue;
      const normalizedUri = normalizePersistedNarraMediaUri(persistedUri);
      const validationKey = `${character.id}:${normalizedUri}`;
      if (validatedPortraitsRef.current.has(validationKey)) continue;
      validatedPortraitsRef.current.add(validationKey);
      void FileSystem.getInfoAsync(normalizedUri).then((info) => {
        if (cancelled) return;
        if (!info.exists) {
          updateCharacter(bookId, character.id, { portraitUri: undefined });
        } else if (normalizedUri !== persistedUri) {
          updateCharacter(bookId, character.id, { portraitUri: normalizedUri });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [bookId, characters, updateCharacter]);

  const analyze = useCallback(async () => {
    if (!book || analysisActiveRef.current) return;
    analysisActiveRef.current = true;
    portraitAttemptsRef.current.clear();
    try {
      if (__DEV__ && process.env.EXPO_PUBLIC_NARRA_USE_MOCKS === "1") {
        setAnalysisStage(t("narra.analyzing", "Ищу героев…"));
        await analyzeBookCharacters(book);
        return;
      }
      setAnalysisStage(t("narra.extracting", "Извлекаю текст…"));
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
      setAnalysisStage(t("narra.analyzing", "Ищу героев…"));
      await analyzeBookCharacters(book, extractedText);
    } catch (error) {
      const normalized = reportNarraError("character_analysis_ui", error);
      Alert.alert(
        t("narra.analysisFailedTitle", "Не удалось найти персонажей"),
        normalized.message,
      );
    } finally {
      analysisActiveRef.current = false;
      setAnalysisStage("");
    }
  }, [book, t]);

  useEffect(() => {
    if (!book || busy || portraitLoading) return;
    const nextCharacter = characters.find(
      (character) =>
        isCharacterUnlocked(book.progress, character) &&
        !character.portraitUri &&
        !portraitAttemptsRef.current.has(character.id),
    );
    if (!nextCharacter) return;

    portraitAttemptsRef.current.add(nextCharacter.id);
    setPortraitLoading(nextCharacter.id);
    void generateCharacterPortrait(bookId, nextCharacter)
      .then((portraitUri) => updateCharacter(bookId, nextCharacter.id, { portraitUri }))
      .catch((error) => reportNarraError("character_portrait_background", error))
      .finally(() => setPortraitLoading(null));
  }, [book, bookId, busy, characters, portraitLoading, updateCharacter]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior={characters.length === 0 ? "never" : "automatic"}
      contentContainerStyle={styles.content}
      style={styles.container}
    >
      <ExtractorWebView ref={extractorRef} />
      {characters.length === 0 ? (
        <CenteredEmptyState
          title={t("narra.meetCharacters", "Персонажей пока нет")}
          description={t("narra.analysisDescription", "Найдём их в тексте книги")}
        >
          <View style={styles.emptyActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={busy ? analysisStage : t("narra.findCharacters", "Найти героев")}
              activeOpacity={0.82}
              disabled={busy || !book}
              onPress={() => void analyze()}
              style={[styles.primaryButton, (busy || !book) && styles.disabled]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {t("narra.findCharacters", "Найти героев")}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </CenteredEmptyState>
      ) : (
        <View style={styles.list}>
          {characters.map((character, index) => {
            const unlocked = isCharacterUnlocked(book?.progress ?? 0, character);
            const portraitBusy = portraitLoading === character.id;
            return (
              <View key={character.id}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={
                    unlocked
                      ? t("narra.openCharacterChat", "Открыть чат с {{character}}", {
                          character: character.name,
                        })
                      : t("narra.characterLocked", "Персонаж ещё не открыт")
                  }
                  activeOpacity={unlocked ? 0.62 : 1}
                  disabled={!unlocked}
                  onPress={() =>
                    navigation.navigate("NarraCharacterChat", {
                      bookId,
                      characterId: character.id,
                    })
                  }
                  style={[styles.characterRow, !unlocked && styles.locked]}
                >
                  <View style={styles.avatar}>
                    {character.portraitUri ? (
                      <Image
                        source={{ uri: normalizePersistedNarraMediaUri(character.portraitUri) }}
                        style={styles.avatarImage}
                        onError={() =>
                          updateCharacter(bookId, character.id, { portraitUri: undefined })
                        }
                      />
                    ) : portraitBusy ? (
                      <ActivityIndicator color={colors.primaryForeground} />
                    ) : (
                      <Text style={styles.avatarLetter}>
                        {unlocked ? character.name.slice(0, 1).toUpperCase() : "?"}
                      </Text>
                    )}
                  </View>
                  <View style={styles.characterCopy}>
                    <Text style={styles.characterName} numberOfLines={1}>
                      {unlocked
                        ? character.fullName
                        : t("narra.unknownCharacter", "Неизвестный герой")}
                    </Text>
                    <Text style={styles.characterRole} numberOfLines={1}>
                      {unlocked
                        ? character.role
                        : t("narra.unlockAt", "Откроется после {{progress}}% книги", {
                            progress: Math.round(character.unlockProgress * 100),
                          })}
                    </Text>
                    {unlocked && character.traits.length > 0 ? (
                      <Text style={styles.traits} numberOfLines={1}>
                        {character.traits.join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                  {unlocked ? <ChevronRightIcon size={18} color={colors.mutedForeground} /> : null}
                </TouchableOpacity>
                {index < characters.length - 1 ? <View style={styles.separator} /> : null}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, padding: spacing.lg },
    emptyActions: { alignItems: "center", gap: spacing.md },
    primaryButton: {
      minHeight: 46,
      paddingHorizontal: spacing.xl,
      borderRadius: radius.full,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.primary,
    },
    primaryButtonText: {
      color: colors.primaryForeground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    disabled: { opacity: 0.5 },
    list: {},
    characterRow: {
      minHeight: 80,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md,
    },
    locked: { opacity: 0.52 },
    avatar: {
      width: 56,
      height: 56,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    avatarImage: { width: "100%", height: "100%" },
    avatarLetter: {
      color: colors.primaryForeground,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
    },
    characterCopy: { flex: 1, gap: 2 },
    characterName: {
      color: colors.foreground,
      fontSize: fontSize.md,
      fontWeight: fontWeight.semibold,
    },
    characterRole: { color: colors.mutedForeground, fontSize: fontSize.xs, lineHeight: 18 },
    traits: { color: colors.mutedForeground, fontSize: 11, lineHeight: 16 },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: 56 + spacing.sm,
      backgroundColor: colors.border,
    },
  });
