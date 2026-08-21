import { MorphTransitionSource } from "@/components/navigation/MorphSheetTransition";
import { HostedMishanaerIcon } from "@/components/ui/HostedMishanaerIcon";
import { MishanaerIcon, type MishanaerIconName } from "@/components/ui/MishanaerIcon";
import { Button, HStack, Host, ProgressView, Text } from "@expo/ui/swift-ui";
import {
  Animation,
  accessibilityLabel,
  animation,
  buttonStyle,
  clipShape,
  controlSize,
  frame,
  glassEffect,
  labelStyle,
  padding,
  progressViewStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, Text as RNText, StyleSheet, View } from "react-native";
import type { ReaderToolbarProps } from "./ReaderToolbar.types";

const TOOLBAR_HEIGHT = 50;
const CONTROL_SIZE = 44;
const NAVIGATION_HORIZONTAL_INSET = 20;

export function ReaderToolbar(props: ReaderToolbarProps) {
  const { t } = useTranslation();
  const supportsGlass = Number.parseInt(String(Platform.Version), 10) >= 26;
  const makeModifiers = (label: string, compact = false) =>
    supportsGlass
      ? [
          buttonStyle("plain" as const),
          controlSize("extraLarge" as const),
          ...(compact
            ? [frame({ width: CONTROL_SIZE, height: CONTROL_SIZE })]
            : [
                labelStyle("titleAndIcon" as const),
                frame({ height: CONTROL_SIZE }),
                padding({ horizontal: 14 }),
              ]),
          glassEffect({
            glass: { variant: "regular", interactive: true },
            shape: "capsule",
          }),
          clipShape("capsule" as const),
          tint(props.tintColor),
          accessibilityLabel(label),
        ]
      : [
          buttonStyle("bordered" as const),
          controlSize("extraLarge" as const),
          ...(compact
            ? [frame({ width: CONTROL_SIZE, height: CONTROL_SIZE })]
            : [labelStyle("titleAndIcon" as const), frame({ height: CONTROL_SIZE })]),
          clipShape("capsule" as const),
          tint(props.tintColor),
          accessibilityLabel(label),
        ];

  const speechLoading = props.speechState === "loading";
  const speechActive = props.speechState === "playing";
  const speechLabel = speechActive ? t("common.stop", "Стоп") : t("reader.listen", "Слушать");
  const speechIcon: MishanaerIconName = speechActive ? "stop" : "headphones";
  const speechLoadingLabel = t("reader.audioLoading", "Загрузка аудио");

  return (
    <View style={styles.container}>
      <Host matchContents colorScheme={props.isDark ? "dark" : "light"} style={styles.controlHost}>
        <HStack
          modifiers={[
            animation(
              Animation.spring({ duration: 0.28, bounce: 0 }),
              speechLoading ? 1 : speechActive ? 2 : 0,
            ),
          ]}
        >
          {speechLoading ? (
            <Button
              key={props.speechState}
              onPress={props.onSpeechPress}
              modifiers={makeModifiers(speechLoadingLabel, true)}
            >
              <ProgressView
                modifiers={[
                  controlSize("small"),
                  progressViewStyle("circular"),
                  tint(props.tintColor),
                ]}
              />
            </Button>
          ) : (
            <Button
              key={props.speechState}
              onPress={props.onSpeechPress}
              modifiers={makeModifiers(speechLabel)}
            >
              <HStack spacing={7} alignment="center">
                <HostedMishanaerIcon
                  name={speechIcon}
                  variant="filled"
                  size={20}
                  color={props.tintColor}
                />
                <Text>{speechLabel}</Text>
              </HStack>
            </Button>
          )}
        </HStack>
      </Host>

      <Pressable
        accessibilityLabel={t("narra.characters", "Персонажи")}
        accessibilityRole="button"
        onPress={props.onChatPress}
        style={styles.chatControl}
      >
        <MorphTransitionSource
          pointerEvents="none"
          sourceId={props.chatMorphSourceId}
          style={styles.chatSource}
        >
          {/* A/B §10.9: source-view без SwiftUI Host/Liquid Glass subtree.
              UIKit-backed GlassView + RN-контент; вид кнопки тот же, слои другие. */}
          {isLiquidGlassAvailable() ? (
            <GlassView
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              colorScheme={props.isDark ? "dark" : "light"}
              glassEffectStyle="regular"
              isInteractive
              style={styles.chatCapsule}
            >
              <MishanaerIcon
                name="person"
                variant="filled"
                size={20}
                color={props.tintColor}
              />
              <RNText style={[styles.chatLabel, { color: props.tintColor }]}>
                {t("narra.characters", "Персонажи")}
              </RNText>
            </GlassView>
          ) : (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.chatCapsule,
                props.isDark ? styles.chatFallbackDark : styles.chatFallbackLight,
              ]}
            >
              <MishanaerIcon
                name="person"
                variant="filled"
                size={20}
                color={props.tintColor}
              />
              <RNText style={[styles.chatLabel, { color: props.tintColor }]}>
                {t("narra.characters", "Персонажи")}
              </RNText>
            </View>
          )}
        </MorphTransitionSource>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: TOOLBAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: NAVIGATION_HORIZONTAL_INSET,
  },
  controlHost: {
    height: CONTROL_SIZE,
  },
  chatSource: {
    height: CONTROL_SIZE,
  },
  chatControl: {
    height: CONTROL_SIZE,
  },
  chatCapsule: {
    height: CONTROL_SIZE,
    borderRadius: CONTROL_SIZE / 2,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 14,
  },
  chatLabel: {
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 22,
    letterSpacing: -0.4,
  },
  chatFallbackLight: {
    backgroundColor: "rgba(120, 120, 128, 0.16)",
  },
  chatFallbackDark: {
    backgroundColor: "rgba(118, 118, 128, 0.24)",
  },
});

export { TOOLBAR_HEIGHT };
export type { ReaderToolbarProps } from "./ReaderToolbar.types";
