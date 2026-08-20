import { MorphTransitionSource } from "@/components/navigation/MorphSheetTransition";
import { HostedMishanaerIcon } from "@/components/ui/HostedMishanaerIcon";
import type { MishanaerIconName } from "@/components/ui/MishanaerIcon";
import { Button, HStack, Host, ProgressView, Text } from "@expo/ui/swift-ui";
import {
  Animation,
  accessibilityHidden,
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
import { useTranslation } from "react-i18next";
import { Platform, Pressable, StyleSheet, View } from "react-native";
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
        accessibilityLabel={t("narra.chat", "Чат")}
        accessibilityRole="button"
        onPress={props.onChatPress}
        style={styles.chatControl}
      >
        <MorphTransitionSource
          pointerEvents="none"
          sourceId={props.chatMorphSourceId}
          style={styles.chatSource}
        >
          <Host
            matchContents
            pointerEvents="none"
            colorScheme={props.isDark ? "dark" : "light"}
            style={styles.controlHost}
          >
            <Button
              onPress={() => {}}
              modifiers={[...makeModifiers(t("narra.chat", "Чат")), accessibilityHidden(true)]}
            >
              <HStack spacing={7} alignment="center">
                <HostedMishanaerIcon
                  name="chat-bubble"
                  variant="filled"
                  size={20}
                  color={props.tintColor}
                />
                <Text>{t("narra.chat", "Чат")}</Text>
              </HStack>
            </Button>
          </Host>
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
});

export { TOOLBAR_HEIGHT };
export type { ReaderToolbarProps } from "./ReaderToolbar.types";
