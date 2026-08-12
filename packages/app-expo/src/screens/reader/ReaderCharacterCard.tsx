import { NativeCharacterDetailsCells } from "@/components/narra/NativeCharacterDetailsCells";
import { CharacterPortraitImage } from "@/components/narra/character-portrait-image";
import { Text } from "@/components/ui/Typography";
import { NarraAudioPlayer } from "@/lib/narra/audio-player";
import { hasCharacterPortrait, resolveCharacterPortraitUri } from "@/lib/narra/character-portrait";
import { isCharacterUnlocked } from "@/lib/narra/domain";
import { reportNarraError } from "@/lib/narra/errors";
import { ensureCharacterPortrait, synthesizeNarraSpeech } from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
import { useLibraryStore, useNarraStore } from "@/stores";
import {
  type ThemeColors,
  fontSize,
  largeTitleFontSize,
  largeTitleLineHeight,
  radius,
  spacing,
  useTheme,
} from "@/styles/theme";
import {
  interfaceFontFamily,
  serifCondensedFontFamily,
  serifTextFontFamily,
} from "@deslop/primitives/native";
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Defs,
  FeGaussianBlur,
  Filter,
  LinearGradient,
  Mask,
  Rect,
  Stop,
  Svg,
  Image as SvgImage,
} from "react-native-svg";
import ReadAnyNativeControls from "../../../modules/native-controls";
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
  /** Storybook-only loading state without starting a real image request. */
  portraitLoadingPreview?: boolean;
  /** Переход в ридер книги из заглушки запертого героя («Продолжить чтение»). */
  onContinueReading?: () => void;
}

type VoiceSampleState = "idle" | "loading" | "playing";

export type ReaderCharacterCardHandle = {
  regeneratePortrait: () => void;
};

const DEFAULT_PORTRAIT_BACKGROUND = "#2c2219";
const PORTRAIT_BACKGROUND_SAMPLE_FRACTION = 0.1;
const PROGRESSIVE_TRANSITION_START = 0.35;
const PROGRESSIVE_TRANSITION_STOPS = [
  { offset: 0, opacity: 0 },
  { offset: 0.15, opacity: 0.03 },
  { offset: 0.3, opacity: 0.1 },
  { offset: 0.45, opacity: 0.22 },
  { offset: 0.6, opacity: 0.4 },
  { offset: 0.75, opacity: 0.62 },
  { offset: 0.9, opacity: 0.85 },
  { offset: 1, opacity: 1 },
] as const;
const portraitBackgroundCache = new Map<string, string>();

function formatCharacterTraits(traits: readonly string[]): string {
  const value = traits
    .map((trait) => trait.trim())
    .filter(Boolean)
    .join(", ");

  return value ? `${value[0].toLocaleUpperCase("ru-RU")}${value.slice(1)}` : "";
}

function splitNameIntoTwoBalancedLines(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name;

  let bestBreak = 1;
  let smallestDifference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const firstLineLength = words.slice(0, index).join(" ").length;
    const secondLineLength = words.slice(index).join(" ").length;
    const difference = Math.abs(firstLineLength - secondLineLength);
    if (difference < smallestDifference) {
      bestBreak = index;
      smallestDifference = difference;
    }
  }

  return `${words.slice(0, bestBreak).join(" ")}\n${words.slice(bestBreak).join(" ")}`;
}

function foregroundForBackground(color: string): {
  isDark: boolean;
  primary: string;
  secondary: string;
} {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.58
    ? {
        isDark: false,
        primary: "rgba(0,0,0,0.9)",
        secondary: "rgba(0,0,0,0.62)",
      }
    : {
        isDark: true,
        primary: "rgba(255,255,255,0.96)",
        secondary: "rgba(255,255,255,0.72)",
      };
}

function ProgressivePortraitTransition({
  backgroundColor,
  uri,
}: {
  backgroundColor: string;
  uri: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const blurId = `portrait-blur-${id}`;
  const blurMaskId = `portrait-blur-mask-${id}`;
  const blurMaskGradientId = `portrait-blur-mask-gradient-${id}`;
  const colorFadeId = `portrait-color-fade-${id}`;

  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} viewBox="0 0 75 100">
      <Defs>
        <Filter id={blurId} x="-20%" y="-20%" width="140%" height="140%">
          <FeGaussianBlur stdDeviation={3.2} edgeMode="duplicate" />
        </Filter>
        <LinearGradient id={blurMaskGradientId} x1="0" y1="0" x2="0" y2="1">
          {PROGRESSIVE_TRANSITION_STOPS.map(({ offset, opacity }) => (
            <Stop key={offset} offset={String(offset)} stopColor="#fff" stopOpacity={opacity} />
          ))}
        </LinearGradient>
        <Mask id={blurMaskId} x="0" y="0" width="75" height="100">
          <Rect
            x="0"
            y={PROGRESSIVE_TRANSITION_START * 100}
            width="75"
            height={(1 - PROGRESSIVE_TRANSITION_START) * 100}
            fill={`url(#${blurMaskGradientId})`}
          />
        </Mask>
        <LinearGradient id={colorFadeId} x1="0" y1="0" x2="0" y2="1">
          {PROGRESSIVE_TRANSITION_STOPS.map(({ offset, opacity }) => (
            <Stop
              key={offset}
              offset={String(
                PROGRESSIVE_TRANSITION_START + offset * (1 - PROGRESSIVE_TRANSITION_START),
              )}
              stopColor={backgroundColor}
              stopOpacity={opacity}
            />
          ))}
        </LinearGradient>
      </Defs>
      <SvgImage
        x="0"
        y="0"
        width="75"
        height="100"
        href={{ uri }}
        preserveAspectRatio="xMidYMid slice"
        filter={`url(#${blurId})`}
        mask={`url(#${blurMaskId})`}
      />
      <Rect x="0" y="0" width="75" height="100" fill={`url(#${colorFadeId})`} />
    </Svg>
  );
}

/**
 * Карточка героя (по образцу CharacterCard из десктопной narra): крупный портрет
 * с регенерацией, имя серифом, роль, черты-чипсы с тонкой рамкой, манера речи
 * caps-лейблом и ряд кнопок «Поговорить» / «Послушать голос». Запертый герой —
 * тизер без портрета и досье (антиспойлер) с кнопкой «Продолжить чтение».
 * Голос назначается автоматически по правилам voice-rules — пикер не показываем.
 */
export const ReaderCharacterCard = forwardRef<ReaderCharacterCardHandle, ReaderCharacterCardProps>(
  function ReaderCharacterCard(
    {
      visible,
      character,
      bookId,
      onClose,
      onOpenChat,
      onContinueReading,
      embedded = false,
      showActions = true,
      portraitLoadingPreview = false,
    },
    ref,
  ) {
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
    const liveCharacter = portraitLoadingPreview ? character : (storedCharacter ?? character);
    const unlocked = liveCharacter ? isCharacterUnlocked(bookProgress, liveCharacter) : true;
    const [portraitLoading, setPortraitLoading] = useState(false);
    const portraitBusy = portraitLoadingPreview || portraitLoading;
    const portraitAttemptsRef = useRef(new Set<string>());
    const [voiceState, setVoiceState] = useState<VoiceSampleState>("idle");
    const [nameFit, setNameFit] = useState<{
      name: string;
      needsFitting: boolean;
    } | null>(null);
    const audioRef = useRef(new NarraAudioPlayer());
    // Растущий id запроса синтеза: устаревший ответ не должен заиграть после отмены.
    const voiceRequestRef = useRef(0);

    const portraitUri = resolveCharacterPortraitUri(liveCharacter);
    const portraitPending = embedded && !portraitUri;
    const [portraitBackgroundColor, setPortraitBackgroundColor] = useState(
      portraitUri
        ? (portraitBackgroundCache.get(portraitUri) ?? DEFAULT_PORTRAIT_BACKGROUND)
        : embedded
          ? DEFAULT_PORTRAIT_BACKGROUND
          : colors.background,
    );
    const portraitForeground = useMemo(
      () => foregroundForBackground(portraitBackgroundColor),
      [portraitBackgroundColor],
    );

    useEffect(() => {
      if (!embedded || !portraitUri) return;
      const cached = portraitBackgroundCache.get(portraitUri);
      if (cached) {
        setPortraitBackgroundColor(cached);
        return;
      }

      let cancelled = false;
      setPortraitBackgroundColor(DEFAULT_PORTRAIT_BACKGROUND);
      void Promise.resolve()
        .then(() =>
          ReadAnyNativeControls.averageBottomImageColor(
            portraitUri,
            PORTRAIT_BACKGROUND_SAMPLE_FRACTION,
          ),
        )
        .then((color) => {
          if (cancelled || !/^#[0-9a-f]{6}$/i.test(color)) return;
          portraitBackgroundCache.set(portraitUri, color);
          setPortraitBackgroundColor(color);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [embedded, portraitUri]);

    const stopVoiceSample = () => {
      voiceRequestRef.current += 1;
      audioRef.current.stop();
      setVoiceState("idle");
    };

    useEffect(() => () => audioRef.current.stop(), []);

    // Закрытие карточки или смена героя останавливают пробу голоса.
    const characterId = character?.id;
    useEffect(() => {
      if (visible && characterId) return;
      voiceRequestRef.current += 1;
      audioRef.current.stop();
      setVoiceState("idle");
    }, [visible, characterId]);

    const generatePortrait = (force: boolean) => {
      if (!character || portraitBusy) return;
      setPortraitLoading(true);
      const target = force
        ? { ...character, portraitAssetId: undefined, portraitUri: undefined }
        : character;
      void ensureCharacterPortrait(bookId, target)
        .then((uri) =>
          updateCharacter(bookId, character.id, {
            portraitUri: uri,
            portraitUriOverridesAsset: force,
          }),
        )
        .catch((error) => reportNarraError("character_portrait_reader_card", error))
        .finally(() => setPortraitLoading(false));
    };

    useImperativeHandle(ref, () => ({
      regeneratePortrait: () => generatePortrait(true),
    }));

    // Портрет по требованию — тот же механизм, что и в NarraCharactersScreen;
    // для запертого героя не генерируем (антиспойлер и лишний расход).
    useEffect(() => {
      if (
        portraitLoadingPreview ||
        !visible ||
        !unlocked ||
        !character ||
        hasCharacterPortrait(character)
      )
        return;
      if (portraitAttemptsRef.current.has(character.id)) return;
      portraitAttemptsRef.current.add(character.id);
      setPortraitLoading(true);
      void ensureCharacterPortrait(bookId, character)
        .then((uri) => updateCharacter(bookId, character.id, { portraitUri: uri }))
        .catch((error) => reportNarraError("character_portrait_reader_card", error))
        .finally(() => setPortraitLoading(false));
    }, [visible, unlocked, character, bookId, portraitLoadingPreview, updateCharacter]);

    if (!character || !liveCharacter) return null;

    const displayName = character.fullName || character.name;
    const nameNeedsFitting = nameFit?.name === displayName && nameFit.needsFitting;
    const fittedDisplayName = nameNeedsFitting
      ? splitNameIntoTwoBalancedLines(displayName)
      : displayName;

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

    const portraitContent = (
      <View style={[styles.portraitFrame, embedded && styles.embeddedPortraitFrame]}>
        <View style={[styles.portrait, embedded && styles.embeddedPortrait]}>
          <CharacterPortraitImage
            character={liveCharacter}
            style={styles.portraitImage}
            fallback={
              portraitBusy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.portraitLetter}>
                  {character.name.slice(0, 1).toUpperCase()}
                </Text>
              )
            }
          />
          {embedded && portraitUri ? (
            <ProgressivePortraitTransition
              uri={portraitUri}
              backgroundColor={portraitBackgroundColor}
            />
          ) : null}
          {portraitUri && !portraitBusy && !embedded ? (
            <View style={styles.portraitButtonsRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("narra.regeneratePortrait", "Сгенерировать портрет заново")}
                onPress={() => generatePortrait(true)}
                style={styles.regenButton}
              >
                <Text style={styles.regenIcon}>↻</Text>
              </Pressable>
            </View>
          ) : null}
          {portraitBusy && portraitUri ? (
            <View style={styles.portraitOverlay}>
              <ActivityIndicator color={colors.background} />
            </View>
          ) : null}
        </View>
      </View>
    );

    const characterDetails = (
      <View
        collapsable={false}
        style={[
          styles.characterSection,
          embedded && !portraitPending && styles.embeddedCharacterSection,
          portraitPending && styles.embeddedPendingCharacterSection,
        ]}
      >
        <View style={[styles.characterInfo, embedded && styles.embeddedCharacterInfo]}>
          {embedded ? (
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              onTextLayout={({ nativeEvent }) => {
                const needsFitting = nativeEvent.lines.length > 2;
                setNameFit((current) =>
                  current?.name === displayName && current.needsFitting === needsFitting
                    ? current
                    : { name: displayName, needsFitting },
                );
              }}
              pointerEvents="none"
              style={[styles.name, styles.embeddedName, styles.embeddedNameMeasurement]}
            >
              {displayName}
            </Text>
          ) : null}
          <Text
            adjustsFontSizeToFit={embedded && nameNeedsFitting}
            minimumFontScale={embedded && nameNeedsFitting ? 0.5 : undefined}
            numberOfLines={embedded ? 2 : undefined}
            style={[
              styles.name,
              embedded && styles.embeddedName,
              embedded && { color: portraitForeground.primary },
            ]}
          >
            {fittedDisplayName}
          </Text>
          {embedded && showActions ? (
            <View style={styles.embeddedActionsBlock}>
              <View style={styles.nativeActionsContainer}>
                <ReaderCharacterActions
                  talkLabel={t("narra.writeToCharacter", "Написать")}
                  listenLabel={t("narra.voiceCharacter", "Озвучить")}
                  stopLabel={t("narra.stopVoiceSample", "Остановить озвучку")}
                  regenerateLabel={t("narra.regeneratePortrait", "Перегенерировать портрет")}
                  onTalk={() => onOpenChat(character)}
                  onToggleVoice={toggleVoiceSample}
                  onRegenerate={() => generatePortrait(true)}
                  canSample={canSample}
                  regenerating={portraitBusy}
                  showRegenerate={Boolean(portraitUri)}
                  voiceState={voiceState}
                  isDark={portraitForeground.isDark}
                  foregroundColor={portraitForeground.primary}
                  primaryForegroundColor={colors.primary5}
                />
              </View>
            </View>
          ) : null}
          {embedded ? (
            <View style={styles.embeddedDetailsBlock}>
              <NativeCharacterDetailsCells
                bio={character.role || "—"}
                bioLabel={t("narra.bio", "Био")}
                cellBackgroundColor={colors.primary10}
                character={formatCharacterTraits(character.traits) || "—"}
                characterLabel={t("narra.character", "Характер")}
                isDark={portraitForeground.isDark}
              />
            </View>
          ) : character.role ? (
            <Text style={styles.description}>{character.role}</Text>
          ) : null}
          {!embedded && character.traits.length > 0 ? (
            <Text style={styles.description}>{formatCharacterTraits(character.traits)}</Text>
          ) : null}
          {!embedded && liveCharacter.speechStyle ? (
            <View style={styles.speechSection}>
              <Text
                style={[
                  styles.sectionLabel,
                  embedded && portraitUri && { color: portraitForeground.secondary },
                ]}
              >
                {t("narra.speechStyle", "Манера речи")}
              </Text>
              <Text
                style={[
                  styles.description,
                  embedded && portraitUri && { color: portraitForeground.secondary },
                ]}
              >
                {liveCharacter.speechStyle}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    );

    const content = (
      <View
        collapsable={false}
        style={[
          styles.sheet,
          embedded && styles.embedded,
          portraitPending && styles.embeddedPending,
          { paddingBottom: embedded ? 0 : (insets.bottom || spacing.md) + spacing.md },
        ]}
      >
        {!embedded ? <View style={styles.grabber} /> : null}
        {embedded && unlocked ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: portraitBackgroundColor }]}
          />
        ) : null}
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
            {portraitPending ? (
              <View style={styles.embeddedPendingContent}>{characterDetails}</View>
            ) : embedded ? (
              <ScrollView
                style={styles.embeddedDetailsScroll}
                contentInsetAdjustmentBehavior="never"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.embeddedDetailsScrollContent}
              >
                {portraitContent}
                {characterDetails}
              </ScrollView>
            ) : (
              <ScrollView
                contentInsetAdjustmentBehavior="never"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
              >
                {portraitContent}
                {characterDetails}
              </ScrollView>
            )}
            {showActions && !embedded ? (
              <View style={styles.nativeActionsContainer}>
                <ReaderCharacterActions
                  talkLabel={t("narra.writeToCharacter", "Написать")}
                  listenLabel={t("narra.voiceCharacter", "Озвучить")}
                  stopLabel={t("narra.stopVoiceSample", "Остановить озвучку")}
                  regenerateLabel={t("narra.regeneratePortrait", "Перегенерировать портрет")}
                  onTalk={() => onOpenChat(character)}
                  onToggleVoice={toggleVoiceSample}
                  onRegenerate={() => generatePortrait(true)}
                  canSample={canSample}
                  regenerating={portraitBusy}
                  showRegenerate={Boolean(portraitUri)}
                  voiceState={voiceState}
                  isDark={isDark}
                  foregroundColor={colors.foreground}
                  primaryForegroundColor={colors.background}
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
  },
);

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
      gap: 0,
      paddingHorizontal: 0,
      paddingTop: 0,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
    },
    embeddedPending: {
      flex: 0,
      alignSelf: "stretch",
      backgroundColor: DEFAULT_PORTRAIT_BACKGROUND,
    },
    embeddedPendingContent: {
      alignSelf: "stretch",
    },
    embeddedDetailsScroll: {
      flex: 1,
      alignSelf: "stretch",
      zIndex: 1,
    },
    embeddedDetailsScrollContent: {
      flexGrow: 1,
      paddingBottom: 0,
    },
    grabber: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.primary10,
    },
    scrollContent: {
      alignSelf: "stretch",
      alignItems: "center",
      gap: spacing.md,
      paddingBottom: spacing.sm,
    },
    portraitFrame: {
      alignSelf: "center",
      borderRadius: radius.card,
      backgroundColor: "transparent",
    },
    embeddedPortraitFrame: {
      alignSelf: "stretch",
      width: "100%",
      borderRadius: 0,
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
    embeddedPortrait: {
      width: "100%",
      height: undefined,
      aspectRatio: 3 / 4,
      borderRadius: 0,
    },
    portraitImage: { width: "100%", height: "100%" },
    portraitLetter: {
      color: colors.mutedForeground,
      fontFamily: serifTextFontFamily.bold,
      fontSize: fontSize["2xl"],
    },
    portraitOverlay: {
      ...StyleSheet.absoluteFill,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      backgroundColor: "rgba(0,0,0,0.3)",
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
    // Тот же SB Serif Condensed и тот же Title 40, что у large title на главной.
    name: {
      color: colors.foreground,
      fontFamily: serifCondensedFontFamily.regular,
      fontSize: largeTitleFontSize,
      lineHeight: largeTitleLineHeight,
      textAlign: "center",
    },
    embeddedName: {
      alignSelf: "stretch",
      maxWidth: "100%",
      paddingHorizontal: spacing.xxl,
      textShadowColor: "rgba(0, 0, 0, 0.5)",
      textShadowOffset: { width: 0, height: 2 },
      textShadowRadius: 20,
    },
    embeddedNameMeasurement: {
      position: "absolute",
      top: 0,
      right: 0,
      left: 0,
      opacity: 0,
    },
    characterInfo: {
      width: "100%",
      alignItems: "center",
      gap: spacing.xxl,
    },
    characterSection: {
      width: "100%",
      alignItems: "center",
    },
    embeddedCharacterSection: {
      minHeight: 340,
      marginTop: "-32%",
      paddingTop: spacing.xl,
      paddingBottom: 40,
      zIndex: 1,
    },
    embeddedPendingCharacterSection: {
      minHeight: 0,
      // Reserve the native grabber area, then keep 20 pt before the heading.
      paddingTop: spacing.xxl + spacing.md,
      paddingBottom: spacing.xl,
    },
    embeddedCharacterInfo: {
      zIndex: 1,
      gap: 0,
    },
    // Роль и манера речи — SB Sans, спокойный тёмно-серый (cardv2__role)
    description: {
      color: colors.mutedForeground,
      fontFamily: interfaceFontFamily.regular,
      fontSize: fontSize.sm,
      lineHeight: 22,
      textAlign: "center",
    },
    speechSection: {
      alignSelf: "stretch",
      alignItems: "center",
      gap: spacing.xs,
    },
    nativeActionsContainer: { width: "100%", height: 68 },
    embeddedActionsBlock: {
      width: "100%",
      paddingTop: spacing.xxl,
    },
    embeddedDetailsBlock: {
      width: "100%",
    },
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
