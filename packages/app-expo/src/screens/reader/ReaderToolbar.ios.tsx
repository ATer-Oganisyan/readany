import { HostedMishanaerIcon } from "@/components/ui/HostedMishanaerIcon";
import type { MishanaerIconName } from "@/components/ui/MishanaerIcon";
import { Button, HStack, Host, ProgressView, Spacer, Text } from "@expo/ui/swift-ui";
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
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
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
    <Host
      colorScheme={props.isDark ? "dark" : "light"}
      style={{ width: "100%", height: TOOLBAR_HEIGHT }}
    >
      <HStack
        spacing={0}
        alignment="center"
        modifiers={[
          frame({ maxWidth: 10_000, height: TOOLBAR_HEIGHT }),
          padding({ horizontal: NAVIGATION_HORIZONTAL_INSET }),
          animation(
            Animation.spring({ duration: 0.28, bounce: 0 }),
            speechLoading ? 1 : speechActive ? 2 : 0,
          ),
        ]}
      >
        {speechLoading ? (
          <Button onPress={props.onSpeechPress} modifiers={makeModifiers(speechLoadingLabel, true)}>
            <ProgressView
              modifiers={[
                controlSize("small"),
                progressViewStyle("circular"),
                tint(props.tintColor),
              ]}
            />
          </Button>
        ) : (
          <Button onPress={props.onSpeechPress} modifiers={makeModifiers(speechLabel)}>
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
        <Spacer />
        <Button onPress={props.onChatPress} modifiers={makeModifiers(t("narra.chat", "Чат"))}>
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
      </HStack>
    </Host>
  );
}

export { TOOLBAR_HEIGHT };
export type { ReaderToolbarProps } from "./ReaderToolbar.types";
