import { interfaceFontFamily } from "@deslop/primitives/native";
import { Button, HStack, Host, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  controlSize,
  font,
  frame,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { StyleSheet, useWindowDimensions } from "react-native";
import type { ReaderCharacterActionsProps } from "./ReaderCharacterActions.types";

export function ReaderCharacterActions(props: ReaderCharacterActionsProps) {
  const { width } = useWindowDimensions();
  const labelWidth = Math.max(96, (width - 138) / 2);
  const labelModifiers = [
    font({ family: interfaceFontFamily.semibold, size: 14 }),
    frame({ width: labelWidth }),
  ];

  return (
    <Host colorScheme={props.isDark ? "dark" : "light"} style={styles.host}>
      <HStack spacing={10}>
        <Button
          onPress={props.onTalk}
          modifiers={[
            controlSize("large"),
            buttonStyle("borderedProminent"),
            tint(props.foregroundColor),
            accessibilityLabel(props.talkLabel),
          ]}
        >
          <Text modifiers={labelModifiers}>{props.talkLabel}</Text>
        </Button>
        {props.canSample ? (
          <Button
            onPress={props.onToggleVoice}
            modifiers={[
              controlSize("large"),
              buttonStyle("bordered"),
              tint(props.foregroundColor),
              accessibilityLabel(props.voiceState !== "idle" ? props.stopLabel : props.listenLabel),
            ]}
          >
            <Text modifiers={labelModifiers}>
              {props.voiceState !== "idle" ? props.stopLabel : props.listenLabel}
            </Text>
          </Button>
        ) : null}
      </HStack>
    </Host>
  );
}

const styles = StyleSheet.create({ host: { width: "100%", height: 52 } });
