import { NarraLoopVideo } from "@/components/narra/NarraLoopVideo";
import { Text } from "@/components/ui/Typography";
import { hasBundledOpenRouterKey } from "@/config/bundled-ai";
import { animateNarraImage } from "@/lib/narra/animate-openrouter";
import { buildPortraitMotionPrompt } from "@/lib/narra/animate-prompt";
import { NarraAudioPlayer } from "@/lib/narra/audio-player";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import { reportNarraError } from "@/lib/narra/errors";
import {
  ensureCharacterPortrait,
  normalizePersistedNarraMediaUri,
  synthesizeNarraSpeech,
} from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
import { useLibraryStore, useNarraStore } from "@/stores";
import { type ThemeColors, fontSize, radius, spacing, useTheme } from "@/styles/theme";
import { interfaceFontFamily, serifTextFontFamily } from "@deslop/primitives/native";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ReaderCharacterActions } from "./ReaderCharacterActions";

interface ReaderCharacterCardProps {
  visible: boolean;
  character: NarraCharacter | null;
  bookId: string;
  onClose: () => void;
  onOpenChat: (character: NarraCharacter) => void;
  /** Контент без собственного Modal — для системного native-stack formSheet. */
  embedded?: boolean;
  showActions?: boolean;
  /** Переход в ридер книги из заглушки запертого героя («Продолжить чтение»). */
  onContinueReading?: () => void;
}

type VoiceSampleState = "idle" | "loading" | "playing";

/**
 * Карточка героя (по образцу CharacterCard из десктопной narra): крупный портрет
 * с регенерацией, имя серифом, роль, черты-чипсы с тонкой рамкой, манера речи
 * caps-лейблом и ряд кнопок «Поговорить» / «Послушать голос». Запертый герой —
 * тизер без портрета и досье (антиспойлер) с кнопкой «Продолжить чтение».
 * Голос назначается автоматически по правилам voice-rules — пикер не показываем.
 */
export function ReaderCharacterCard({
  visible,
  character,
  bookId,
  onClose,
  onOpenChat,
  onContinueReading,
  embedded = false,
  showActions = true,
}: ReaderCharacterCardProps) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const updateCharacter = useNarraStore((state) => state.updateCharacter);
  const bookProgress = useLibraryStore(
    (state) => state.books.find((item) => item.id === bookId)?.progress ?? 0,
  );
  // Живой персонаж из стора: после регенерации портрета проп-снимок устаревает.
  const storedCharacter = useNarraStore((state) =>
    character
      ? state.books[bookId]?.characters.find((item) => item.id === character.id)
      : undefined,
  );
  const liveCharacter = storedCharacter ?? character;
  const unlocked = liveCharacter ? isCharacterUnlocked(bookProgress, liveCharacter) : true;
  const [portraitLoading, setPortraitLoading] = useState(false);
  const [portraitAnimating, setPortraitAnimating] = useState(false);
  const [showPortraitVideo, setShowPortraitVideo] = useState(false);
  const portraitAttemptsRef = useRef(new Set<string>());
  const [voiceState, setVoiceState] = useState<VoiceSampleState>("idle");
  const audioRef = useRef(new NarraAudioPlayer());
  // Растущий id запроса синтеза: устаревший ответ не должен заиграть после отмены.
  const voiceRequestRef = useRef(0);

  const portraitUri = liveCharacter?.portraitUri
    ? normalizePersistedNarraMediaUri(liveCharacter.portraitUri)
    : undefined;
  // Кэш «ожившего» портрета: повторный тап играет без генерации (P18).
  const portraitVideoUri = liveCharacter?.portraitVideoUri
    ? normalizePersistedNarraMediaUri(liveCharacter.portraitVideoUri)
    : undefined;

  const stopVoiceSample = () => {
    voiceRequestRef.current += 1;
    audioRef.current.stop();
    setVoiceState("idle");
  };

  useEffect(() => () => audioRef.current.stop(), []);

  // Закрытие карточки или смена героя останавливают пробу голоса и видео.
  const characterId = character?.id;
  useEffect(() => {
    if (visible && characterId) return;
    voiceRequestRef.current += 1;
    audioRef.current.stop();
    setVoiceState("idle");
    setShowPortraitVideo(false);
  }, [visible, characterId]);

  const generatePortrait = (force: boolean) => {
    if (!character || portraitLoading) return;
    setPortraitLoading(true);
    // Новый портрет обесценивает старое «ожившее» видео
    setShowPortraitVideo(false);
    const target = force ? { ...character, portraitUri: undefined } : character;
    void ensureCharacterPortrait(bookId, target)
      .then((uri) =>
        updateCharacter(bookId, character.id, {
          portraitUri: uri,
          ...(force ? { portraitVideoUri: undefined } : null),
        }),
      )
      .catch((error) => reportNarraError("character_portrait_reader_card", error))
      .finally(() => setPortraitLoading(false));
  };

  // «Оживление» портрета (P18): image-to-video тем же модулем, что и сцены.
  // Генерация ТОЛЬКО по явному тапу (платные вызовы), кэш — в персонаже.
  const runPortraitAnimation = () => {
    if (!character || !portraitUri || portraitAnimating || portraitLoading) return;
    setPortraitAnimating(true);
    void animateNarraImage({
      imageUri: portraitUri,
      motionPrompt: buildPortraitMotionPrompt(),
      cacheKey: `${bookId}-${character.id}-portrait-video`,
    })
      .then((uri) => {
        updateCharacter(bookId, character.id, { portraitVideoUri: uri });
        setShowPortraitVideo(true);
      })
      .catch((error) => {
        const normalized = reportNarraError("character_portrait_animate", error);
        Alert.alert(
          t("narra.animatePortraitFailedTitle", "Не удалось оживить портрет"),
          normalized.message,
        );
      })
      .finally(() => setPortraitAnimating(false));
  };

  // Тап: кэшированное видео играет сразу; долгий тап — регенерация.
  const animatePortrait = (regenerate: boolean) => {
    if (portraitAnimating) return;
    if (!hasBundledOpenRouterKey) {
      Alert.alert(t("narra.animateNeedKey", "Нужен ключ OpenRouter"));
      return;
    }
    if (!regenerate && portraitVideoUri) {
      setShowPortraitVideo(true);
      return;
    }
    setShowPortraitVideo(false);
    runPortraitAnimation();
  };

  // Портрет по требованию — тот же механизм, что и в NarraCharactersScreen;
  // для запертого героя не генерируем (антиспойлер и лишний расход).
  useEffect(() => {
    if (!visible || !unlocked || !character || character.portraitUri) return;
    if (portraitAttemptsRef.current.has(character.id)) return;
    portraitAttemptsRef.current.add(character.id);
    setPortraitLoading(true);
    void ensureCharacterPortrait(bookId, character)
      .then((uri) => updateCharacter(bookId, character.id, { portraitUri: uri }))
      .catch((error) => reportNarraError("character_portrait_reader_card", error))
      .finally(() => setPortraitLoading(false));
  }, [visible, unlocked, character, bookId, updateCharacter]);

  if (!character || !liveCharacter) return null;

  // Проба голоса — существующий синтез ответа чата (synthesizeNarraSpeech):
  // фраза героя его назначенным голосом; повторный тап останавливает.
  const samplePhrase = (
    liveCharacter.greeting ||
    liveCharacter.speechExamples[0] ||
    liveCharacter.role ||
    ""
  ).trim();
  const sampleVoice = liveCharacter.voiceOverride || liveCharacter.voice;
  const canSample = Boolean(samplePhrase && sampleVoice);

  const toggleVoiceSample = () => {
    if (voiceState !== "idle") {
      stopVoiceSample();
      return;
    }
    if (!canSample) return;
    const requestId = ++voiceRequestRef.current;
    setVoiceState("loading");
    void synthesizeNarraSpeech(samplePhrase, sampleVoice, {
      prosody: liveCharacter.voiceOverride ? undefined : liveCharacter.voiceProsody,
    })
      .then((uri) => {
        if (voiceRequestRef.current !== requestId) return;
        setVoiceState("playing");
        audioRef.current.play(uri, () => setVoiceState("idle"));
      })
      .catch((error) => {
        const normalized = reportNarraError("character_voice_sample", error);
        if (voiceRequestRef.current !== requestId) return;
        setVoiceState("idle");
        Alert.alert(
          t("narra.voiceSampleFailedTitle", "Не удалось озвучить героя"),
          normalized.message,
        );
      });
  };

  const lockedHint = liveCharacter.appearanceChapter
    ? t(
        "narra.lockedCharacterChapterHint",
        "Появится в главе {{chapter}}. Дочитай — и герой откроется: портрет, характер и живой разговор.",
        { chapter: liveCharacter.appearanceChapter },
      )
    : t(
        "narra.lockedCharacterProgressHint",
        "Откроется на {{percent}}% книги. Дочитай — и герой откроется: портрет, характер и живой разговор.",
        { percent: Math.round(Math.min(1, Math.max(0, liveCharacter.unlockProgress)) * 100) },
      );

  const content = (
    <View
      style={[
        styles.sheet,
        embedded && styles.embedded,
        { paddingBottom: (insets.bottom || spacing.md) + spacing.md },
      ]}
    >
      {!embedded ? <View style={styles.grabber} /> : null}
      {!unlocked ? (
        // Тизер запертого героя — как char-teaser в narra: имя и обещание без спойлеров
        <View style={styles.teaser}>
          <View style={styles.teaserMark}>
            <Text style={styles.teaserMarkText}>?</Text>
          </View>
          <Text style={styles.name}>{liveCharacter.name}</Text>
          <Text style={styles.teaserHint}>{lockedHint}</Text>
          {onContinueReading ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("narra.continueReading", "Продолжить чтение")}
              onPress={onContinueReading}
              style={({ pressed }) => [
                styles.primaryPill,
                styles.teaserButton,
                pressed && styles.pillPressed,
              ]}
            >
              <Text style={styles.primaryPillText}>
                {t("narra.continueReading", "Продолжить чтение")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          <ScrollView
            style={
              embedded ? [styles.embeddedScroll, { transform: [{ translateX: 14 }] }] : undefined
            }
            contentInsetAdjustmentBehavior="never"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.scrollContent, embedded && styles.embeddedScrollContent]}
          >
            {/* Крупный портрет в рамке, как в карточке narra */}
            <View style={styles.portraitFrame}>
              <View style={styles.portrait}>
                {showPortraitVideo && portraitVideoUri ? (
                  // «Оживший» портрет — зацикленное видео НА МЕСТЕ картинки
                  <NarraLoopVideo
                    accessibilityLabel={t("narra.portraitVideoLabel", "Оживший портрет")}
                    uri={portraitVideoUri}
                    style={styles.portraitImage}
                  />
                ) : portraitUri ? (
                  <Image
                    source={{ uri: portraitUri }}
                    style={styles.portraitImage}
                    resizeMode="cover"
                    onError={() =>
                      updateCharacter(bookId, character.id, { portraitUri: undefined })
                    }
                  />
                ) : portraitLoading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={styles.portraitLetter}>
                    {character.name.slice(0, 1).toUpperCase()}
                  </Text>
                )}
                {portraitUri && !portraitLoading ? (
                  <View style={styles.portraitButtonsRow}>
                    {showPortraitVideo && portraitVideoUri ? (
                      // Возврат к статичному портрету
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("narra.portraitVideoStop", "Показать портрет")}
                        onPress={() => setShowPortraitVideo(false)}
                        style={styles.regenButton}
                      >
                        <Text style={styles.regenIcon}>■</Text>
                      </Pressable>
                    ) : (
                      <>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t(
                            "narra.regeneratePortrait",
                            "Сгенерировать портрет заново",
                          )}
                          disabled={portraitAnimating}
                          onPress={() => generatePortrait(true)}
                          style={styles.regenButton}
                        >
                          <Text style={styles.regenIcon}>↻</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("narra.animatePortrait", "Оживить портрет")}
                          disabled={portraitAnimating}
                          onPress={() => animatePortrait(false)}
                          onLongPress={() => animatePortrait(true)}
                          style={styles.regenButton}
                        >
                          {portraitAnimating ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={styles.regenIcon}>▶</Text>
                          )}
                        </Pressable>
                      </>
                    )}
                  </View>
                ) : null}
                {portraitLoading && portraitUri ? (
                  <View style={styles.portraitOverlay}>
                    <ActivityIndicator color={colors.background} />
                  </View>
                ) : null}
                {portraitAnimating ? (
                  <View style={styles.portraitOverlay}>
                    <ActivityIndicator color={colors.background} />
                    <Text style={styles.portraitOverlayHint}>
                      {t("narra.portraitAnimating", "Оживляем…")}
                    </Text>
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
          {showActions ? (
            <View style={styles.nativeActionsContainer}>
              <ReaderCharacterActions
                talkLabel={t("narra.talkToCharacter", "Поговорить")}
                listenLabel={t("narra.listenVoice", "Послушать голос")}
                stopLabel={t("narra.stopVoiceSample", "Остановить озвучку")}
                onTalk={() => onOpenChat(character)}
                onToggleVoice={toggleVoiceSample}
                canSample={canSample}
                voiceState={voiceState}
                isDark={isDark}
                foregroundColor={colors.foreground}
              />
            </View>
          ) : null}
        </>
      )}
    </View>
  );

  if (embedded) return content;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel={t("common.close", "Закрыть")}
        onPress={onClose}
      />
      {content}
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
    embedded: {
      flex: 1,
      maxHeight: "100%",
      paddingTop: spacing.lg,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
    },
    embeddedScroll: { flex: 1, width: "100%", alignSelf: "stretch" },
    embeddedScrollContent: { paddingTop: spacing.md, paddingBottom: 84 },
    grabber: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.primary10,
    },
    scrollContent: {
      width: "100%",
      alignItems: "center",
      gap: spacing.md,
      paddingBottom: spacing.sm,
    },
    portraitFrame: {
      alignSelf: "center",
      borderRadius: radius.card,
      backgroundColor: "transparent",
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
      fontFamily: serifTextFontFamily.bold,
      fontSize: fontSize["2xl"],
    },
    portraitOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      backgroundColor: "rgba(0,0,0,0.3)",
    },
    portraitOverlayHint: {
      color: "#fff",
      fontFamily: interfaceFontFamily.regular,
      fontSize: fontSize.xs,
      textAlign: "center",
    },
    // Ряд круглых кнопок на портрете: ↻ регенерация и ▶ «Оживить» (P18)
    portraitButtonsRow: {
      position: "absolute",
      bottom: spacing.sm,
      alignSelf: "center",
      flexDirection: "row",
      gap: spacing.sm,
    },
    regenButton: {
      width: 40,
      height: 40,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    regenIcon: {
      color: "#fff",
      fontFamily: interfaceFontFamily.semibold,
      fontSize: fontSize.lg,
    },
    // Имя — крупно серифом (SB Serif Text Bold), как cardv2__name в narra
    name: {
      color: colors.foreground,
      fontFamily: serifTextFontFamily.bold,
      fontSize: fontSize["2xl"],
      lineHeight: 32,
      textAlign: "center",
    },
    // Роль и манера речи — SB Sans, спокойный тёмно-серый (cardv2__role)
    description: {
      color: colors.mutedForeground,
      fontFamily: interfaceFontFamily.regular,
      fontSize: fontSize.sm,
      lineHeight: 22,
      textAlign: "center",
    },
    traitsWrap: {
      alignSelf: "stretch",
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: spacing.sm,
    },
    // Чипсы черт: прозрачный фон + тонкая серая рамка + полное скругление (.chip)
    traitChip: {
      paddingHorizontal: 13,
      paddingVertical: 6,
      borderRadius: radius.full,
      backgroundColor: "transparent",
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: colors.border,
    },
    traitText: {
      color: colors.mutedForeground,
      fontFamily: interfaceFontFamily.regular,
      fontSize: fontSize.xs,
    },
    speechSection: {
      alignSelf: "stretch",
      alignItems: "center",
      gap: spacing.xs,
    },
    nativeActionsContainer: { width: "100%", height: 52 },
    sectionLabel: {
      color: colors.mutedForeground,
      fontFamily: interfaceFontFamily.caps,
      fontSize: fontSize.xs,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    // «Поговорить» — чёрная пилюля с белым текстом (btn--primary, var(--ink));
    // в тёмной теме инвертируется вместе с foreground/background.
    primaryPill: {
      flex: 1,
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.foreground,
    },
    primaryPillText: {
      color: colors.background,
      fontFamily: interfaceFontFamily.semibold,
      fontSize: fontSize.sm,
    },
    // «Послушать голос» — белая пилюля с тонкой рамкой (btn--ghost)
    ghostPill: {
      flex: 1,
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    ghostPillText: {
      color: colors.foreground,
      fontFamily: interfaceFontFamily.semibold,
      fontSize: fontSize.sm,
    },
    pillPressed: { opacity: 0.72 },
    teaser: {
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.xl,
    },
    teaserMark: {
      width: 72,
      height: 72,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.elevation2,
    },
    teaserMarkText: {
      color: colors.mutedForeground,
      fontFamily: serifTextFontFamily.bold,
      fontSize: fontSize["2xl"],
    },
    teaserHint: {
      color: colors.mutedForeground,
      fontFamily: interfaceFontFamily.regular,
      fontSize: fontSize.sm,
      lineHeight: 22,
      textAlign: "center",
      paddingHorizontal: spacing.md,
    },
    teaserButton: {
      alignSelf: "stretch",
      flex: 0,
      marginTop: spacing.sm,
    },
  });
