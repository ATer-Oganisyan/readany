import { Button, HStack, Host, ProgressView, Spacer } from "@expo/ui/swift-ui";
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
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import type { ReaderToolbarProps } from "./ReaderToolbar.types";

const TOOLBAR_HEIGHT = 50;
const CONTROL_SIZE = 44;
const NAVIGATION_HORIZONTAL_INSET = 20;

type SFSymbol = NonNullable<ComponentProps<typeof Button>["systemImage"]>;

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
  const speechSymbol: SFSymbol = speechActive ? "stop.fill" : "airpods.max";
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
          <Button
            label={speechLabel}
            systemImage={speechSymbol}
            onPress={props.onSpeechPress}
            modifiers={makeModifiers(speechLabel)}
          />
        )}
        <Spacer />
        <Button
          label={t("narra.chat", "Чат")}
          systemImage="message.fill"
          onPress={props.onChatPress}
          modifiers={makeModifiers(t("narra.chat", "Чат"))}
        />
      </HStack>
    </Host>
  );
}

export { TOOLBAR_HEIGHT };
export type { ReaderToolbarProps } from "./ReaderToolbar.types";
