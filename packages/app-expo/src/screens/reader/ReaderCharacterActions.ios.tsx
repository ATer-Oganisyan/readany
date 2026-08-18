import { HostedMishanaerIcon } from "@/components/ui/HostedMishanaerIcon";
import type { MishanaerIconName } from "@/components/ui/MishanaerIcon";
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
import { Platform, StyleSheet } from "react-native";
import type { ReaderCharacterActionsProps } from "./ReaderCharacterActions.types";

export function ReaderCharacterActions(props: ReaderCharacterActionsProps) {
  const supportsGlass = Number.parseInt(String(Platform.Version), 10) >= 26;
  const actions: Array<{
    label: string;
    icon: MishanaerIconName;
    onPress: () => void;
    disabled: boolean;
  }> = [
    {
      label: props.talkLabel,
      icon: "chat-bubble",
      onPress: props.onTalk,
      disabled: false,
    },
    {
      label: props.voiceState !== "idle" ? props.stopLabel : props.listenLabel,
      icon:
        props.voiceState === "loading"
          ? "pulse-circle"
          : props.voiceState === "playing"
            ? "stop"
            : "volume-2",
      onPress: props.onToggleVoice,
      disabled: !props.canSample,
    },
  ];

  if (props.showRegenerate) {
    actions.push({
      label: props.regenerateLabel,
      icon: props.regenerating ? "pulse-circle" : "repeat",
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
          <Button key={action.label} onPress={action.onPress} modifiers={modifiers}>
            <HostedMishanaerIcon name={action.icon} size={28} color={props.foregroundColor} />
          </Button>
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
