import { Button, HStack, Host, Spacer } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  clipShape,
  controlSize,
  frame,
  glassEffect,
  labelStyle,
  padding,
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
  const makeModifiers = (label: string) =>
    supportsGlass
      ? [
          buttonStyle("plain" as const),
          controlSize("extraLarge" as const),
          labelStyle("titleAndIcon" as const),
          frame({ height: CONTROL_SIZE }),
          padding({ horizontal: 14 }),
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
          labelStyle("titleAndIcon" as const),
          frame({ height: CONTROL_SIZE }),
          clipShape("capsule" as const),
          tint(props.tintColor),
          accessibilityLabel(label),
        ];

  const speechLabel = props.speechActive ? t("common.stop", "Стоп") : t("reader.listen", "Слушать");
  const speechSymbol: SFSymbol = props.speechActive ? "stop.fill" : "airpods.max";

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
        ]}
      >
        <Button
          label={speechLabel}
          systemImage={speechSymbol}
          onPress={props.onSpeechPress}
          modifiers={makeModifiers(speechLabel)}
        />
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
