import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { reportNarraError } from "@/lib/narra/errors";
import { ensureCharacterPortrait, normalizePersistedNarraMediaUri } from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
import { useNarraStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useTheme } from "@/styles/theme";
import { interfaceFontFamily, serifTextFontFamily } from "@deslop/primitives/native";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ReaderCharacterCardProps {
  visible: boolean;
  character: NarraCharacter | null;
  bookId: string;
  onClose: () => void;
  onOpenChat: (character: NarraCharacter) => void;
}

/**
 * Карточка героя в ридере (по образцу карточки narra): крупный портрет с
 * регенерацией, имя, раскрытое досье (роль), черты, манера речи и переход в чат.
 * Голос назначается автоматически по правилам voice-rules — пикер не показываем.
 */
export function ReaderCharacterCard({
  visible,
  character,
  bookId,
  onClose,
  onOpenChat,
}: ReaderCharacterCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const updateCharacter = useNarraStore((state) => state.updateCharacter);
  // Живой персонаж из стора: после регенерации портрета проп-снимок устаревает.
  const storedCharacter = useNarraStore((state) =>
    character
      ? state.books[bookId]?.characters.find((item) => item.id === character.id)
      : undefined,
  );
  const liveCharacter = storedCharacter ?? character;
  const [portraitLoading, setPortraitLoading] = useState(false);
  const portraitAttemptsRef = useRef(new Set<string>());

  const portraitUri = liveCharacter?.portraitUri
    ? normalizePersistedNarraMediaUri(liveCharacter.portraitUri)
    : undefined;

  const generatePortrait = (force: boolean) => {
    if (!character || portraitLoading) return;
    setPortraitLoading(true);
    const target = force ? { ...character, portraitUri: undefined } : character;
    void ensureCharacterPortrait(bookId, target)
      .then((uri) => updateCharacter(bookId, character.id, { portraitUri: uri }))
      .catch((error) => reportNarraError("character_portrait_reader_card", error))
      .finally(() => setPortraitLoading(false));
  };

  // Портрет по требованию — тот же механизм, что и в NarraCharactersScreen
  useEffect(() => {
    if (!visible || !character || character.portraitUri) return;
    if (portraitAttemptsRef.current.has(character.id)) return;
    portraitAttemptsRef.current.add(character.id);
    setPortraitLoading(true);
    void ensureCharacterPortrait(bookId, character)
      .then((uri) => updateCharacter(bookId, character.id, { portraitUri: uri }))
      .catch((error) => reportNarraError("character_portrait_reader_card", error))
      .finally(() => setPortraitLoading(false));
  }, [visible, character, bookId, updateCharacter]);

  if (!character || !liveCharacter) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel={t("common.close", "Закрыть")}
        onPress={onClose}
      />
      <View style={[styles.sheet, { paddingBottom: (insets.bottom || spacing.md) + spacing.md }]}>
        <View style={styles.grabber} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Крупный портрет в рамке, как в карточке narra */}
          <View style={styles.portraitFrame}>
            <View style={styles.portrait}>
              {portraitUri ? (
                <Image
                  source={{ uri: portraitUri }}
                  style={styles.portraitImage}
                  resizeMode="cover"
                  onError={() => updateCharacter(bookId, character.id, { portraitUri: undefined })}
                />
              ) : portraitLoading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.portraitLetter}>
                  {character.name.slice(0, 1).toUpperCase()}
                </Text>
              )}
              {portraitUri && !portraitLoading ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("narra.regeneratePortrait", "Сгенерировать портрет заново")}
                  onPress={() => generatePortrait(true)}
                  style={styles.regenButton}
                >
                  <Text style={styles.regenIcon}>↻</Text>
                </Pressable>
              ) : null}
              {portraitLoading && portraitUri ? (
                <View style={styles.portraitOverlay}>
                  <ActivityIndicator color={colors.primaryForeground} />
                </View>
              ) : null}
            </View>
          </View>
          <Text style={styles.name}>{character.fullName || character.name}</Text>
          {/* Досье: роль/описание раскрыто целиком */}
          {character.role ? <Text style={styles.description}>{character.role}</Text> : null}
          {character.traits.length > 0 ? (
            <View style={styles.traitsWrap}>
              {character.traits.map((trait) => (
                <View key={trait} style={styles.traitChip}>
                  <Text style={styles.traitText}>{trait}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {liveCharacter.speechStyle ? (
            <View style={styles.speechSection}>
              <Text style={styles.sectionLabel}>{t("narra.speechStyle", "Манера речи")}</Text>
              <Text style={styles.description}>{liveCharacter.speechStyle}</Text>
            </View>
          ) : null}
        </ScrollView>
        <NativeButton
          label={t("narra.characterCardOpenChat", "Перейти в чат")}
          accessibilityLabel={t("narra.openCharacterChat", "Открыть чат с {{character}}", {
            character: character.name,
          })}
          size="large"
          onPress={() => onOpenChat(character)}
        />
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.4)",
    },
    sheet: {
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      backgroundColor: colors.background,
      maxHeight: "82%",
    },
    grabber: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.primary10,
    },
    scrollContent: {
      gap: spacing.md,
      paddingBottom: spacing.sm,
    },
    portraitFrame: {
      alignSelf: "center",
      padding: 5,
      borderRadius: radius.card + 5,
      backgroundColor: colors.primary,
    },
    portrait: {
      width: 224,
      height: 280,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.card,
      backgroundColor: colors.elevation2,
      position: "relative",
    },
    portraitImage: { width: "100%", height: "100%" },
    portraitLetter: {
      color: colors.mutedForeground,
      fontSize: fontSize["2xl"],
      fontWeight: fontWeight.bold,
    },
    portraitOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.3)",
    },
    regenButton: {
      position: "absolute",
      bottom: spacing.sm,
      alignSelf: "center",
      width: 40,
      height: 40,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    regenIcon: {
      color: "#fff",
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
    },
    name: {
      color: colors.foreground,
      fontFamily: serifTextFontFamily.bold,
      fontSize: fontSize["2xl"],
      textAlign: "center",
    },
    description: {
      color: colors.foreground,
      fontFamily: interfaceFontFamily.regular,
      fontSize: fontSize.md,
      lineHeight: 22,
    },
    traitsWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
    },
    traitChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
      borderRadius: radius.full,
      backgroundColor: colors.elevation1,
      borderWidth: 0.5,
      borderColor: colors.primary5,
    },
    traitText: {
      color: colors.foreground,
      fontSize: fontSize.xs,
    },
    speechSection: {
      gap: spacing.xs,
    },
    sectionLabel: {
      color: colors.mutedForeground,
      fontFamily: interfaceFontFamily.caps,
      fontSize: fontSize.xs,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
  });
