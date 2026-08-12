import { Button, GlassEffectContainer, HStack, Host } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  controlSize,
  disabled,
  frame,
  glassEffect,
  labelStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";
import { Platform, StyleSheet } from "react-native";
import type { ReaderCharacterActionsProps } from "./ReaderCharacterActions.types";

type SFSymbol = NonNullable<ComponentProps<typeof Button>["systemImage"]>;

export function ReaderCharacterActions(props: ReaderCharacterActionsProps) {
  const supportsGlass = Number.parseInt(String(Platform.Version), 10) >= 26;
  const actions: Array<{
    label: string;
    symbol: SFSymbol;
    onPress: () => void;
    disabled: boolean;
  }> = [
    {
      label: props.talkLabel,
      symbol: "message.fill",
      onPress: props.onTalk,
      disabled: false,
    },
    {
      label: props.voiceState !== "idle" ? props.stopLabel : props.listenLabel,
      symbol:
        props.voiceState === "loading"
          ? "hourglass"
          : props.voiceState === "playing"
            ? "stop.fill"
            : "speaker.wave.2.fill",
      onPress: props.onToggleVoice,
      disabled: !props.canSample,
    },
  ];

  if (props.showRegenerate) {
    actions.push({
      label: props.regenerateLabel,
      symbol: props.regenerating ? "hourglass" : "arrow.clockwise",
      onPress: props.onRegenerate,
      disabled: props.regenerating,
    });
  }

  const buttons = (
    <HStack spacing={16} alignment="center">
      {actions.map((action) => {
        const modifiers = supportsGlass
          ? [
              buttonStyle("plain" as const),
              controlSize("extraLarge" as const),
              labelStyle("iconOnly" as const),
              frame({ width: 64, height: 64 }),
              glassEffect({ glass: { variant: "regular", interactive: true }, shape: "circle" }),
              tint(props.foregroundColor),
              disabled(action.disabled),
              accessibilityLabel(action.label),
            ]
          : [
              buttonStyle("bordered" as const),
              controlSize("extraLarge" as const),
              labelStyle("iconOnly" as const),
              frame({ width: 64, height: 64 }),
              tint(props.foregroundColor),
              disabled(action.disabled),
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
    </HStack>
  );

  return (
    <Host colorScheme={props.isDark ? "dark" : "light"} style={styles.host}>
      {supportsGlass ? (
        <GlassEffectContainer spacing={16}>{buttons}</GlassEffectContainer>
      ) : (
        buttons
      )}
    </Host>
  );
}

const styles = StyleSheet.create({ host: { width: "100%", height: 68 } });
