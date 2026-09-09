// Source: SchroederNathan/expo-ui-examples/src/examples/mini-player/player-screen.tsx
// MIT: vendor/expo-ui-examples-LICENSE.txt. Transport layout adapted to a native sheet.
import { useTheme } from "@/styles/ThemeContext";
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
import {
  Button,
  HStack,
  Image,
  ProgressView,
  Slider,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  disabled,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import { useTranslation } from "react-i18next";
import { PlatformColor, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PreviousSentenceIcon from "../../../assets/icons/sentence-backward.svg";
import NextSentenceIcon from "../../../assets/icons/sentence-forward.svg";

import { AudiobookCover } from "./audiobook-cover";
import type { AudiobookPlayerContentProps } from "./audiobook-player-content.types";

const primary = foregroundStyle({ type: "hierarchical", style: "primary" });
const dim = foregroundStyle({ type: "hierarchical", style: "secondary" });

function SentenceButton({
  direction,
  enabled,
  onPress,
  label,
}: {
  direction: "previous" | "next";
  enabled: boolean;
  onPress: () => void;
  label: string;
}) {
  const Icon = direction === "previous" ? PreviousSentenceIcon : NextSentenceIcon;
  return (
    <Button
      onPress={onPress}
      modifiers={[buttonStyle("plain"), accessibilityLabel(label), disabled(!enabled)]}
    >
      <RNHostView matchContents>
        <View
          pointerEvents="none"
          accessible={false}
          style={{
            width: 48,
            height: 48,
            alignItems: "center",
            justifyContent: "center",
            opacity: enabled ? 1 : 0.35,
          }}
        >
          <Icon width={34} height={34} color={PlatformColor("label")} />
        </View>
      </RNHostView>
    </Button>
  );
}

export function AudiobookPlayerContent(props: AudiobookPlayerContentProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { width } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const { player } = props;
  const contentInset = 33;
  const contentW = Math.min(width - contentInset * 2, 408);
  const headerExtraWidth = contentInset - spacingPixels[24];

  return (
    <Host
      colorScheme={isDark ? "dark" : "light"}
      // This single-line layout is 309pt including the sheet’s bottom safe area.
      // Reserve it before SwiftUI measures, so fitToContents cannot resize mid-transition.
      style={{ height: 309 - bottom }}
      ignoreSafeArea="container"
    >
      <VStack spacing={0}>
        <HStack
          spacing={spacingPixels[16]}
          modifiers={[
            frame({ width: contentW + headerExtraWidth }),
            padding({ top: 34, leading: headerExtraWidth }),
          ]}
        >
          <RNHostView matchContents>
            <AudiobookCover height={56} showShadow={false} />
          </RNHostView>
          <VStack
            alignment="leading"
            spacing={spacingPixels[4]}
            modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" })]}
          >
            <Text
              modifiers={[
                font({ family: largeTitleFontFamily, size: title24Typography.fontSize }),
                primary,
                lineLimit(1),
                minimumScaleFactor(title20Typography.fontSize / title24Typography.fontSize),
                truncationMode("tail"),
                fixedSize({ horizontal: false, vertical: true }),
                frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
              ]}
            >
              {props.title}
            </Text>
            {props.author ? (
              <Text
                modifiers={[
                  font({ family: largeTitleFontFamily, size: bodyTypography.fontSize }),
                  dim,
                  lineLimit(1),
                ]}
              >
                {props.author}
              </Text>
            ) : null}
          </VStack>
        </HStack>

        <Slider
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
            disabled(!player.hasDuration),
            accessibilityLabel(t("tts.narrationProgress")),
          ]}
        />
        <HStack
          spacing={spacingPixels[8]}
          modifiers={[frame({ width: contentW }), padding({ top: 11 })]}
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

        <HStack spacing={48} modifiers={[padding({ top: 40, bottom: Math.max(0, 40 - bottom) })]}>
          <SentenceButton
            direction="previous"
            enabled={props.canGoToPreviousSentence}
            onPress={props.onPreviousSentence}
            label={t("tts.prevSentence")}
          />
          <Button
            onPress={player.togglePlayback}
            modifiers={[
              buttonStyle("plain"),
              accessibilityLabel(
                t(player.isPlaying || player.isLoading ? "tts.pause" : "tts.playShort"),
              ),
            ]}
          >
            {player.isLoading ? (
              <ProgressView modifiers={[frame({ width: 58, height: 58 })]} />
            ) : (
              <Image
                systemName={player.isPlaying ? "pause.fill" : "play.fill"}
                size={50}
                modifiers={[primary, frame({ width: 58, height: 58 })]}
              />
            )}
          </Button>
          <SentenceButton
            direction="next"
            enabled={props.canGoToNextSentence}
            onPress={props.onNextSentence}
            label={t("tts.nextSentence")}
          />
        </HStack>
      </VStack>
    </Host>
  );
}
