import { Text } from "@/components/ui/Typography";
import { NarraAudioPlayer } from "@/lib/narra/audio-player";
import { reportNarraError } from "@/lib/narra/errors";
import { synthesizeNarraSpeech } from "@/lib/narra/media";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { ReaderCharacterActions } from "@/screens/reader/ReaderCharacterActions";
import { ReaderCharacterCard } from "@/screens/reader/ReaderCharacterCard";
import { useNarraStore } from "@/stores";
import { type ThemeColors, fontSize, spacing, useTheme } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<RootStackParamList, "NarraCharacterProfile">;

export function NarraCharacterProfileScreen({ route, navigation }: Props) {
  const { bookId, characterId } = route.params;
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const character = useNarraStore((state) =>
    state.books[bookId]?.characters.find((item) => item.id === characterId),
  );
  const [voiceState, setVoiceState] = useState<"idle" | "loading" | "playing">("idle");
  const audioRef = useRef(new NarraAudioPlayer());
  const voiceRequestRef = useRef(0);
  const samplePhrase = (
    character?.greeting ||
    character?.speechExamples[0] ||
    character?.role ||
    ""
  ).trim();
  const sampleVoice = character?.voiceOverride || character?.voice;
  const canSample = Boolean(samplePhrase && sampleVoice);

  useEffect(() => () => audioRef.current.stop(), []);

  const toggleVoiceSample = () => {
    if (voiceState !== "idle") {
      voiceRequestRef.current += 1;
      audioRef.current.stop();
      setVoiceState("idle");
      return;
    }
    if (!character || !sampleVoice || !samplePhrase) return;
    const requestId = ++voiceRequestRef.current;
    setVoiceState("loading");
    void synthesizeNarraSpeech(samplePhrase, sampleVoice, {
      prosody: character.voiceOverride ? undefined : character.voiceProsody,
    })
      .then((uri) => {
        if (voiceRequestRef.current !== requestId) return;
        setVoiceState("playing");
        audioRef.current.play(uri, () => setVoiceState("idle"));
      })
      .catch((error) => {
        if (voiceRequestRef.current !== requestId) return;
        setVoiceState("idle");
        Alert.alert(
          t("narra.voiceSampleFailedTitle", "Не удалось озвучить героя"),
          reportNarraError("character_voice_sample", error).message,
        );
      });
  };

  useLayoutEffect(() => {
    const close = () => navigation.goBack();

    navigation.setOptions({
      title: character?.name || t("narra.characterProfile", "Профиль персонажа"),
      ...(Platform.OS === "ios"
        ? {
            headerRight: undefined,
            unstable_headerLeftItems: () => [
              {
                type: "button" as const,
                label: "",
                width: 64,
                disabled: true,
                hidesSharedBackground: true,
                onPress: () => {},
              },
            ],
            unstable_headerRightItems: () => [
              {
                type: "button" as const,
                label: t("common.done", "Готово"),
                accessibilityLabel: t("common.close", "Закрыть"),
                variant: "done" as const,
                onPress: close,
              },
            ],
          }
        : {
            unstable_headerLeftItems: undefined,
            unstable_headerRightItems: undefined,
            headerRight: () => (
              <Pressable accessibilityRole="button" onPress={close} hitSlop={8}>
                <Text style={styles.doneLabel}>{t("common.done", "Готово")}</Text>
              </Pressable>
            ),
          }),
    });
  }, [character?.name, navigation, styles.doneLabel, t]);

  if (!character) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>
          {t("narra.characterUnavailable", "Персонаж недоступен.")}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ReaderCharacterCard
        embedded
        visible
        showActions={false}
        character={character}
        bookId={bookId}
        onClose={() => navigation.goBack()}
        onOpenChat={() => navigation.goBack()}
      />
      <View style={[styles.actionsOverlay, { bottom: (insets.bottom || spacing.md) + spacing.md }]}>
        <ReaderCharacterActions
          talkLabel={t("narra.talkToCharacter", "Поговорить")}
          listenLabel={t("narra.listenVoice", "Послушать голос")}
          stopLabel={t("narra.stopVoiceSample", "Остановить озвучку")}
          onTalk={() => navigation.goBack()}
          onToggleVoice={toggleVoiceSample}
          canSample={canSample}
          voiceState={voiceState}
          isDark={isDark}
          foregroundColor={colors.foreground}
        />
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    actionsOverlay: {
      position: "absolute",
      left: spacing.lg,
      right: spacing.lg,
      height: 52,
    },
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
      backgroundColor: colors.background,
    },
    emptyText: {
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
      textAlign: "center",
    },
    doneLabel: {
      color: colors.primary,
      fontSize: fontSize.sm,
    },
  });
