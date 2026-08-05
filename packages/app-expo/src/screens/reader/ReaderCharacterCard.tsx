import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { reportNarraError } from "@/lib/narra/errors";
import { ensureCharacterPortrait, normalizePersistedNarraMediaUri } from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
import { VOICES } from "@/lib/narra/voice-rules";
import { useNarraStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useTheme } from "@/styles/theme";
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
 * Компактная карточка героя в ридере: открывается по тапу на имя персонажа
 * в тексте. Портрет (генерируется штатным механизмом media.ts, если ещё нет),
 * роль и черты — и переход в чат с героем.
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
  // Живой персонаж из стора: после смены голоса проп-снимок устаревает.
  const storedCharacter = useNarraStore((state) =>
    character
      ? state.books[bookId]?.characters.find((item) => item.id === character.id)
      : undefined,
  );
  const liveCharacter = storedCharacter ?? character;
  const [portraitLoading, setPortraitLoading] = useState(false);
  const portraitAttemptsRef = useRef(new Set<string>());

  // Ручной выбор голоса (правило 3): полный список, включая пасхалки
  // Марков/Пират; Фокин скрыт, пока синтез Efo сломан на gateway.
  const voiceOptions = useMemo(() => Object.entries(VOICES).filter(([code]) => code !== "Efo"), []);

  const portraitUri = liveCharacter?.portraitUri
    ? normalizePersistedNarraMediaUri(liveCharacter.portraitUri)
    : undefined;

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

  const autoVoiceName = VOICES[liveCharacter.voice]?.name;
  const setVoiceOverride = (voiceOverride?: string) => {
    updateCharacter(bookId, liveCharacter.id, { voiceOverride });
  };

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
        <View style={styles.headerRow}>
          <View style={styles.portrait}>
            {portraitUri ? (
              <Image
                source={{ uri: portraitUri }}
                style={styles.portraitImage}
                onError={() => updateCharacter(bookId, character.id, { portraitUri: undefined })}
              />
            ) : portraitLoading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.portraitLetter}>{character.name.slice(0, 1).toUpperCase()}</Text>
            )}
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.name} numberOfLines={2}>
              {character.fullName || character.name}
            </Text>
            <Text style={styles.role} numberOfLines={2}>
              {character.role}
            </Text>
          </View>
        </View>
        {character.traits.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.traitsRow}
          >
            {character.traits.map((trait) => (
              <View key={trait} style={styles.traitChip}>
                <Text style={styles.traitText}>{trait}</Text>
              </View>
            ))}
          </ScrollView>
        ) : null}
        {/* Голос озвучки: авто по правилам или ручной выбор (включая пасхалки) */}
        <View style={styles.voiceSection}>
          <Text style={styles.voiceLabel}>{t("narra.voiceTitle", "Голос героя")}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.traitsRow}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: !liveCharacter.voiceOverride }}
              accessibilityLabel={t("narra.voiceAuto", "Авто")}
              onPress={() => setVoiceOverride(undefined)}
              style={[styles.voiceChip, !liveCharacter.voiceOverride && styles.voiceChipActive]}
            >
              <Text
                style={[
                  styles.voiceChipText,
                  !liveCharacter.voiceOverride && styles.voiceChipTextActive,
                ]}
              >
                {autoVoiceName
                  ? t("narra.voiceAutoNamed", "Авто · {{voice}}", { voice: autoVoiceName })
                  : t("narra.voiceAuto", "Авто")}
              </Text>
            </Pressable>
            {voiceOptions.map(([code, info]) => {
              const active = liveCharacter.voiceOverride === code;
              return (
                <Pressable
                  key={code}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={info.name}
                  onPress={() => setVoiceOverride(code)}
                  style={[styles.voiceChip, active && styles.voiceChipActive]}
                >
                  <Text style={[styles.voiceChipText, active && styles.voiceChipTextActive]}>
                    {info.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
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
    },
    grabber: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.primary10,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    portrait: {
      width: 72,
      height: 72,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    portraitImage: { width: "100%", height: "100%" },
    portraitLetter: {
      color: colors.primaryForeground,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
    },
    headerCopy: { flex: 1, gap: 2 },
    name: {
      color: colors.foreground,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
    },
    role: {
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
    },
    traitsRow: {
      flexDirection: "row",
      gap: spacing.xs,
    },
    traitChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.full,
      backgroundColor: colors.elevation1,
      borderWidth: 0.5,
      borderColor: colors.primary5,
    },
    traitText: {
      color: colors.foreground,
      fontSize: fontSize.xs,
    },
    voiceSection: {
      gap: spacing.xs,
    },
    voiceLabel: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    voiceChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.full,
      backgroundColor: colors.elevation1,
      borderWidth: 0.5,
      borderColor: colors.primary5,
    },
    voiceChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    voiceChipText: {
      color: colors.foreground,
      fontSize: fontSize.xs,
    },
    voiceChipTextActive: {
      color: colors.primaryForeground,
      fontWeight: fontWeight.semibold,
    },
  });
