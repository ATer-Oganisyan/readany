import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { hapticLight } from "@/lib/haptics";
import { useTheme } from "@/styles/ThemeContext";
import { foregroundForBackground } from "@/styles/foreground-for-background";
import {
  bodyTypography,
  fontFamily,
  fontSize,
  largeTitleFontFamily,
  title24Typography,
} from "@/styles/theme";
import { spacingPixels } from "@deslop/primitives";
import { Host, RNHostView, Slider } from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import PreviousSentenceIcon from "../../../assets/icons/sentence-backward.svg";
import NextSentenceIcon from "../../../assets/icons/sentence-forward.svg";
import { AnimatedPlayPause } from "./animated-play-pause";
import { AudiobookCover } from "./audiobook-cover";
import type { AudiobookPlayerContentProps } from "./audiobook-player-content.types";

export function AudiobookPlayerContent(props: AudiobookPlayerContentProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const foreground = foregroundForBackground(props.backgroundColor ?? colors.background);
  const color = foreground.primary;
  const layout = useResponsiveLayout();
  const contentW = Math.min(layout.width - 66, 408);
  const columns = layout.isTabletLandscape ? 5 : layout.isTablet ? 4 : 2;
  const coverHeight =
    Math.floor((layout.centeredContentWidth - spacingPixels[16] * (columns - 1)) / columns) *
    (41 / 28) *
    0.72;
  const { player } = props;
  const [editing, setEditing] = useState(false);
  const buttonColor = foreground.isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const trackColor = props.accentColor ?? color;
  const fraction = Math.max(0, Math.min(1, player.localPosition / Math.max(player.duration, 1)));
  const actions = [
    {
      key: "previous",
      Icon: PreviousSentenceIcon,
      label: t("tts.prevSentence"),
      enabled: props.canGoToPreviousSentence,
      onPress: () => {
        player.noteSeek(-1);
        props.onPreviousSentence();
      },
    },
    {
      key: "play",
      Icon: null,
      label: t(player.isPlaying || player.isLoading ? "tts.pause" : "tts.playShort"),
      enabled: true,
      onPress: player.togglePlayback,
    },
    {
      key: "next",
      Icon: NextSentenceIcon,
      label: t("tts.nextSentence"),
      enabled: props.canGoToNextSentence,
      onPress: () => {
        player.noteSeek(1);
        props.onNextSentence();
      },
    },
  ];
  return (
    <ScrollView
      style={{ flexGrow: 0 }}
      nestedScrollEnabled
      contentContainerStyle={{ alignItems: "center", paddingTop: 16, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
    >
      <AudiobookCover height={coverHeight} />
      <View
        style={{
          width: contentW,
          height: 56,
          marginTop: 24,
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
        }}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={20 / 24}
          style={{
            fontFamily: largeTitleFontFamily,
            fontSize: title24Typography.fontSize,
            color,
            textAlign: "center",
          }}
        >
          {props.title}
        </Text>
        {props.author ? (
          <Text
            numberOfLines={1}
            style={{
              fontFamily: largeTitleFontFamily,
              fontSize: bodyTypography.fontSize,
              color: foreground.secondary,
              textAlign: "center",
            }}
          >
            {props.author}
          </Text>
        ) : null}
      </View>
      <Host
        colorScheme={foreground.isDark ? "dark" : "light"}
        // Material reserves half the thumb width at each end of the track.
        style={{ width: contentW + 36, height: 32, marginTop: 24 }}
      >
        <Slider
          value={player.localPosition}
          min={0}
          max={Math.max(player.duration, 1)}
          enabled={player.hasDuration}
          modifiers={[fillMaxWidth()]}
          onValueChange={(value) => {
            if (!editing) {
              setEditing(true);
              player.beginSeeking();
            }
            player.setPosition(value);
          }}
          onValueChangeFinished={() => {
            setEditing(false);
            player.commitSeeking();
          }}
        >
          <Slider.Thumb>
            <RNHostView matchContents>
              <View
                style={{
                  width: 36,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: color,
                  opacity: editing ? 1 : 0,
                }}
              />
            </RNHostView>
          </Slider.Thumb>
          <Slider.Track>
            <RNHostView matchContents>
              <View
                style={{
                  width: contentW,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: buttonColor,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{ width: `${fraction * 100}%`, height: 4, backgroundColor: trackColor }}
                />
              </View>
            </RNHostView>
          </Slider.Track>
        </Slider>
      </Host>
      <View
        style={{
          width: contentW,
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 8,
          marginTop: 4,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: fontFamily.regular,
            fontSize: fontSize.xs,
            color: foreground.secondary,
          }}
        >
          {props.chapter}
        </Text>
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: fontSize.xs,
            color: foreground.secondary,
          }}
        >
          {player.progressLabel}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 24, marginTop: 40 }}>
        {actions.map(({ key, Icon, label, enabled, onPress }) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: !enabled }}
            disabled={!enabled}
            onPressIn={hapticLight}
            onPress={onPress}
            style={{
              width: Icon ? 56 : 80,
              height: Icon ? 56 : 80,
              borderRadius: 40,
              backgroundColor: buttonColor,
              alignItems: "center",
              justifyContent: "center",
              opacity: enabled ? 1 : 0.35,
            }}
          >
            {Icon ? (
              <Icon width={24} height={24} color={color} />
            ) : (
              <AnimatedPlayPause
                isPlaying={player.isPlaying}
                isLoading={player.isLoading}
                direction={player.loadingDirection}
                color={color}
              />
            )}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
