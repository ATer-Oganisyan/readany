// Source: SchroederNathan/expo-ui-examples/src/examples/mini-player/player-screen.tsx
// MIT: vendor/expo-ui-examples-LICENSE.txt. Transport layout adapted to a native sheet.
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { hapticLight } from "@/lib/haptics";
import { useTheme } from "@/styles/ThemeContext";
import { foregroundForBackground } from "@/styles/foreground-for-background";
import {
  bodyTypography,
  fontFamily,
  fontSize,
  largeTitleFontFamily,
  title20Typography,
  title24Typography,
} from "@/styles/theme";
import { spacingPixels } from "@deslop/primitives";
import { Host, RNHostView } from "@expo/ui/swift-ui";
import { Button, HStack, Slider, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonBorderShape,
  buttonStyle,
  disabled,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  onLongPressGesture,
  padding,
  shapes,
  tint,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PreviousSentenceIcon from "../../../assets/icons/sentence-backward.svg";
import NextSentenceIcon from "../../../assets/icons/sentence-forward.svg";

import { AnimatedPlayPause } from "./animated-play-pause";
import { AudiobookCover } from "./audiobook-cover";
import type { AudiobookPlayerContentProps } from "./audiobook-player-content.types";

const primary = foregroundStyle({ type: "hierarchical", style: "primary" });
const dim = foregroundStyle({ type: "hierarchical", style: "secondary" });
// ponytail: iOS 26 glass doubles its press halo; restore it there if the OS rendering is fixed.
const usesPlayerButtonFallback = Number.parseInt(String(Platform.Version), 10) === 26;
const playerButtonStyle = usesPlayerButtonFallback ? "plain" : "glass";

function SentenceButton({
  direction,
  enabled,
  onPress,
  label,
  color,
  backgroundColor,
}: {
  direction: "previous" | "next";
  enabled: boolean;
  onPress: () => void;
  label: string;
  color: string;
  backgroundColor: string;
}) {
  const Icon = direction === "previous" ? PreviousSentenceIcon : NextSentenceIcon;
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle(playerButtonStyle),
        buttonBorderShape("circle"),
        ...(enabled ? [onLongPressGesture(hapticLight, 0)] : []),
        frame({ width: 56, height: 56 }),
        tint(color),
        accessibilityLabel(label),
        disabled(!enabled),
        ...(usesPlayerButtonFallback ? [background(backgroundColor, shapes.circle())] : []),
      ]}
    >
      <RNHostView matchContents>
        <View
          pointerEvents="none"
          accessible={false}
          style={{
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: enabled ? 1 : 0.35,
          }}
        >
          <Icon width={24} height={24} color={color} />
        </View>
      </RNHostView>
    </Button>
  );
}

export function AudiobookPlayerContent(props: AudiobookPlayerContentProps) {
  const { t } = useTranslation();
  const { isDark, colors } = useTheme();
  const foreground = props.backgroundColor
    ? foregroundForBackground(props.backgroundColor)
    : undefined;
  const color = foreground?.primary ?? colors.foreground;
  const contentIsDark = foreground?.isDark ?? isDark;
  const buttonBackgroundColor = contentIsDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";
  const layout = useResponsiveLayout();
  const { width } = layout;
  const { bottom } = useSafeAreaInsets();
  const { player } = props;
  const contentInset = 33;
  const contentW = Math.min(width - contentInset * 2, 408);
  const columns = layout.isTabletLandscape ? 5 : layout.isTablet ? 4 : 2;
  const catalogCoverWidth = Math.floor(
    (layout.centeredContentWidth - spacingPixels[16] * (columns - 1)) / columns,
  );
  const coverHeight = catalogCoverWidth * (41 / 28) * 0.72;

  return (
    <Host
      colorScheme={contentIsDark ? "dark" : "light"}
      // Keep the existing controls height and reserve the centered cover before opening.
      // Reserve it before SwiftUI measures, so fitToContents cannot resize mid-transition.
      style={{ height: 309 + coverHeight + spacingPixels[24] + spacingPixels[20] - bottom }}
      ignoreSafeArea="container"
    >
      <VStack spacing={0}>
        <VStack
          spacing={spacingPixels[24]}
          modifiers={[frame({ width: contentW }), padding({ top: 34 + spacingPixels[20] })]}
        >
          <VStack modifiers={[frame({ width: coverHeight * (28 / 41), height: coverHeight })]}>
            <RNHostView matchContents>
              <AudiobookCover height={coverHeight} />
            </RNHostView>
          </VStack>
          <VStack
            alignment="center"
            spacing={spacingPixels[4]}
            modifiers={[frame({ width: contentW, height: 56, alignment: "center" })]}
          >
            <Text
              modifiers={[
                font({ family: largeTitleFontFamily, size: title24Typography.fontSize }),
                primary,
                lineLimit(1),
                minimumScaleFactor(title20Typography.fontSize / title24Typography.fontSize),
                truncationMode("tail"),
                fixedSize({ horizontal: false, vertical: true }),
                multilineTextAlignment("center"),
                frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "center" }),
              ]}
            >
              {props.title}
            </Text>
            {props.author ? (
              <Text
                modifiers={[
                  font({ family: largeTitleFontFamily, size: bodyTypography.fontSize }),
                  dim,
                  multilineTextAlignment("center"),
                  lineLimit(1),
                ]}
              >
                {props.author}
              </Text>
            ) : null}
          </VStack>
        </VStack>

        <Slider
          hideThumbUnlessEditing
          value={player.localPosition}
          min={0}
          max={Math.max(player.duration, 1)}
          onValueChange={player.setPosition}
          onEditingChanged={(editing) => {
            if (editing) player.beginSeeking();
            else player.commitSeeking();
          }}
          modifiers={[
            frame({ width: contentW }),
            padding({ top: 24 }),
            ...(props.accentColor ? [tint(props.accentColor)] : []),
            disabled(!player.hasDuration),
            accessibilityLabel(t("tts.narrationProgress")),
          ]}
        />
        <HStack
          spacing={spacingPixels[8]}
          modifiers={[frame({ width: contentW }), padding({ top: spacingPixels[4] })]}
        >
          <Text
            modifiers={[font({ family: fontFamily.regular, size: fontSize.xs }), dim, lineLimit(1)]}
          >
            {props.chapter}
          </Text>
          <Spacer />
          <Text
            modifiers={[
              font({ family: fontFamily.regular, size: fontSize.xs }),
              dim,
              monospacedDigit(),
              fixedSize({ horizontal: true }),
            ]}
          >
            {player.progressLabel}
          </Text>
        </HStack>

        <HStack spacing={24} modifiers={[padding({ top: 40, bottom: Math.max(0, 40 - bottom) })]}>
          <SentenceButton
            color={color}
            backgroundColor={buttonBackgroundColor}
            direction="previous"
            enabled={props.canGoToPreviousSentence}
            onPress={() => {
              player.noteSeek(-1);
              props.onPreviousSentence();
            }}
            label={t("tts.prevSentence")}
          />
          <Button
            onPress={player.togglePlayback}
            modifiers={[
              buttonStyle(playerButtonStyle),
              buttonBorderShape("circle"),
              onLongPressGesture(hapticLight, 0),
              frame({ width: 80, height: 80 }),
              tint(color),
              accessibilityLabel(
                t(player.isPlaying || player.isLoading ? "tts.pause" : "tts.playShort"),
              ),
              ...(usesPlayerButtonFallback
                ? [background(buttonBackgroundColor, shapes.circle())]
                : []),
            ]}
          >
            <RNHostView matchContents>
              <AnimatedPlayPause
                isPlaying={player.isPlaying}
                isLoading={player.isLoading}
                direction={player.loadingDirection}
                color={contentIsDark ? "#ffffff" : "#000000"}
              />
            </RNHostView>
          </Button>
          <SentenceButton
            color={color}
            backgroundColor={buttonBackgroundColor}
            direction="next"
            enabled={props.canGoToNextSentence}
            onPress={() => {
              player.noteSeek(1);
              props.onNextSentence();
            }}
            label={t("tts.nextSentence")}
          />
        </HStack>
      </VStack>
    </Host>
  );
}
