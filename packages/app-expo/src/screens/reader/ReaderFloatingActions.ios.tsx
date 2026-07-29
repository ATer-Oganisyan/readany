import { Button, Host, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  controlSize,
  frame,
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
      label: "Перевести главу",
      symbol: "globe",
      active: props.translationActive,
      onPress: props.onTranslate,
    },
    { label: "Озвучить", symbol: "waveform", active: props.speechActive, onPress: props.onSpeech },
    { label: "Обсудить с ИИ", symbol: "message.badge", active: false, onPress: props.onChat },
  ];

  return (
    <Host matchContents colorScheme="dark" style={{ width: 64 }}>
      <VStack spacing={10} alignment="center">
        {actions.map((action) => (
          <Button
            key={action.label}
            label={action.label}
            systemImage={action.symbol}
            onPress={action.onPress}
            modifiers={[
              buttonStyle(
                supportsGlass ? (action.active ? "glassProminent" : "glass") : "bordered",
              ),
              controlSize("extraLarge"),
              labelStyle("iconOnly"),
              tint(action.active ? props.accentColor : "#FFFFFF"),
              frame({ width: 54, height: 54 }),
              accessibilityLabel(action.label),
            ]}
          />
        ))}
      </VStack>
    </Host>
  );
}

export type { ReaderFloatingActionsProps } from "./ReaderFloatingActions.types";
