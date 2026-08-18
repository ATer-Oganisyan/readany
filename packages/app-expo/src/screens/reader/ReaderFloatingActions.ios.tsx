import { HostedMishanaerIcon } from "@/components/ui/HostedMishanaerIcon";
import type { MishanaerIconName } from "@/components/ui/MishanaerIcon";
import { Button, Host, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  clipShape,
  controlSize,
  frame,
  glassEffect,
  labelStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import type { ReaderFloatingActionsProps } from "./ReaderFloatingActions.types";

export function ReaderFloatingActions(props: ReaderFloatingActionsProps) {
  const { t } = useTranslation();
  const supportsGlass = Number.parseInt(String(Platform.Version), 10) >= 26;
  const actions: Array<{
    label: string;
    icon: MishanaerIconName;
    active: boolean;
    onPress: () => void;
  }> = [
    {
      label: t("reader.language", "Язык"),
      icon: "globe",
      active: props.translationActive,
      onPress: props.onTranslate,
    },
    {
      label: t("reader.speak", "Озвучить"),
      icon: "headphones",
      active: props.speechActive,
      onPress: props.onSpeech,
    },
    {
      label: t("reader.discussWithAI", "Обсудить с ИИ"),
      icon: "chat-bubble",
      active: false,
      onPress: props.onChat,
    },
  ];

  return (
    <Host matchContents colorScheme={props.isDark ? "dark" : "light"} style={{ width: 64 }}>
      <VStack spacing={10} alignment="center">
        {actions.map((action) => {
          const modifiers = supportsGlass
            ? [
                buttonStyle("plain" as const),
                controlSize("extraLarge" as const),
                labelStyle("iconOnly" as const),
                frame({ width: 54, height: 54 }),
                glassEffect({
                  glass: {
                    variant: "regular",
                    interactive: true,
                    ...(action.active ? { tint: props.accentColor } : {}),
                  },
                  shape: "circle",
                }),
                clipShape("circle" as const),
                tint(action.active ? "#FFFFFF" : props.foregroundColor),
                accessibilityLabel(action.label),
              ]
            : [
                buttonStyle(action.active ? ("borderedProminent" as const) : ("bordered" as const)),
                controlSize("extraLarge" as const),
                labelStyle("iconOnly" as const),
                frame({ width: 54, height: 54 }),
                clipShape("circle" as const),
                tint(action.active ? props.accentColor : props.foregroundColor),
                accessibilityLabel(action.label),
              ];

          return (
            <Button key={action.label} onPress={action.onPress} modifiers={modifiers}>
              <HostedMishanaerIcon
                name={action.icon}
                size={24}
                color={action.active ? "#FFFFFF" : props.foregroundColor}
              />
            </Button>
          );
        })}
      </VStack>
    </Host>
  );
}

export type { ReaderFloatingActionsProps } from "./ReaderFloatingActions.types";
