import { Text } from "@/components/ui/Typography";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import { NarraAudioPlayer } from "@/lib/narra/audio-player";
import { hasCharacterPortrait } from "@/lib/narra/character-portrait";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import { reportNarraError } from "@/lib/narra/errors";
import { synthesizeNarraSpeech } from "@/lib/narra/media";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useNativeHeaderActions } from "@/navigation/useNativeHeaderActions";
import { ReaderCharacterActions } from "@/screens/reader/ReaderCharacterActions";
import {
  ReaderCharacterCard,
  type ReaderCharacterCardHandle,
} from "@/screens/reader/ReaderCharacterCard";
import { useLibraryStore, useNarraStore } from "@/stores";
import { type ThemeColors, fontSize, spacing, useTheme } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<RootStackParamList, "NarraCharacterProfile">;

export function NarraCharacterProfileScreen({ route, navigation }: Props) {
  const { bookId, characterId, openedFromChat = false } = route.params;
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const character = useNarraStore((state) =>
    state.books[bookId]?.characters.find((item) => item.id === characterId),
  );
  const bookProgress = useLibraryStore(
    (state) => state.books.find((item) => item.id === bookId)?.progress ?? 0,
  );
  const unlocked = character ? isCharacterUnlocked(bookProgress, character) : false;
  const [voiceState, setVoiceState] = useState<"idle" | "loading" | "playing">("idle");
  const audioRef = useRef(new NarraAudioPlayer());
  const characterCardRef = useRef<ReaderCharacterCardHandle>(null);
  const voiceRequestRef = useRef(0);
  const samplePhrase = (
    character?.greeting ||
    character?.speechExamples[0] ||
    character?.role ||
    ""
  ).trim();
  const sampleVoice = character?.voiceOverride || character?.voice;
  const canSample = Boolean(samplePhrase && sampleVoice);
  const canControlPortrait = Boolean(unlocked && character && hasCharacterPortrait(character));

  useNativeHeaderActions({
    right: [
      {
        label: t("narra.regeneratePortrait", "Сгенерировать портрет заново"),
        icon: "refresh",
        sfSymbol: "arrow.clockwise",
        disabled: !canControlPortrait,
        onPress: () => characterCardRef.current?.regeneratePortrait(),
      },
    ],
  });

  const openChat = () => {
    if (openedFromChat) {
      navigation.goBack();
      return;
    }
    navigation.replace("NarraCharacterChat", { bookId, characterId });
  };

  const continueReading = () => {
    navigation.goBack();
    setTimeout(() => void openMobileBook({ bookId, navigation, t }), 0);
  };

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
        ref={characterCardRef}
        embedded
        visible
        showActions={false}
        character={character}
        bookId={bookId}
        onClose={() => navigation.goBack()}
        onOpenChat={openChat}
        onContinueReading={continueReading}
      />
      {unlocked ? (
        <View
          style={[styles.actionsOverlay, { bottom: (insets.bottom || spacing.md) + spacing.md }]}
        >
          <ReaderCharacterActions
            talkLabel={t("narra.talkToCharacter", "Поговорить")}
            listenLabel={t("narra.listenVoice", "Послушать голос")}
            stopLabel={t("narra.stopVoiceSample", "Остановить озвучку")}
            onTalk={openChat}
            onToggleVoice={toggleVoiceSample}
            canSample={canSample}
            voiceState={voiceState}
            isDark={isDark}
            foregroundColor={colors.foreground}
            primaryForegroundColor={colors.background}
          />
        </View>
      ) : null}
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
  });
