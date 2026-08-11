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
import type { ComponentProps } from "react";
import { Platform } from "react-native";
import type { ReaderFloatingActionsProps } from "./ReaderFloatingActions.types";

type SFSymbol = NonNullable<ComponentProps<typeof Button>["systemImage"]>;

export function ReaderFloatingActions(props: ReaderFloatingActionsProps) {
  const supportsGlass = Number.parseInt(String(Platform.Version), 10) >= 26;
  const actions: Array<{
    label: string;
    symbol: SFSymbol;
    active: boolean;
    onPress: () => void;
  }> = [
    {
      label: "Язык",
      symbol: "globe",
      active: props.translationActive,
      onPress: props.onTranslate,
    },
    {
      label: "Озвучить",
      symbol: "airpods.max",
      active: props.speechActive,
      onPress: props.onSpeech,
    },
    { label: "Обсудить с ИИ", symbol: "message.fill", active: false, onPress: props.onChat },
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
            <Button
              key={action.label}
              label={action.label}
              systemImage={action.symbol}
              onPress={action.onPress}
              modifiers={modifiers}
            />
          );
        })}
      </VStack>
    </Host>
  );
}

export type { ReaderFloatingActionsProps } from "./ReaderFloatingActions.types";
