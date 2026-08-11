import { interfaceFontFamily } from "@deslop/primitives/native";
import { Button, Host, OutlinedButton, Row, Text } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, height, weight } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet } from "react-native";
import type { ReaderCharacterActionsProps } from "./ReaderCharacterActions.types";

const labelStyle = {
  fontFamily: interfaceFontFamily.semibold,
  fontSize: 14,
  fontWeight: "600" as const,
};

export function ReaderCharacterActions(props: ReaderCharacterActionsProps) {
  const secondaryLabel = props.voiceState !== "idle" ? props.stopLabel : props.listenLabel;

  return (
    <Host colorScheme={props.isDark ? "dark" : "light"} style={styles.host}>
      <Row
        horizontalArrangement={{ spacedBy: 8 }}
        verticalAlignment="center"
        modifiers={[fillMaxWidth(), height(52)]}
      >
        <Button
          onClick={props.onTalk}
          colors={{
            containerColor: props.foregroundColor,
            contentColor: props.primaryForegroundColor,
          }}
          modifiers={[weight(1), height(48)]}
        >
          <Text color={props.primaryForegroundColor} maxLines={1} style={labelStyle}>
            {props.talkLabel}
          </Text>
        </Button>
        {props.canSample ? (
          <OutlinedButton
            onClick={props.onToggleVoice}
            colors={{ contentColor: props.foregroundColor }}
            modifiers={[weight(1), height(48)]}
          >
            <Text color={props.foregroundColor} maxLines={1} style={labelStyle}>
              {secondaryLabel}
            </Text>
          </OutlinedButton>
        ) : null}
      </Row>
    </Host>
  );
}

const styles = StyleSheet.create({ host: { width: "100%", height: 52 } });
