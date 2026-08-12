import { interfaceFontFamily } from "@deslop/primitives/native";
import { FilledTonalIconButton, Host, Row, Spacer, Text } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, height, size } from "@expo/ui/jetpack-compose/modifiers";
import { Fragment } from "react";
import { StyleSheet } from "react-native";
import type { ReaderCharacterActionsProps } from "./ReaderCharacterActions.types";

export function ReaderCharacterActions(props: ReaderCharacterActionsProps) {
  const actions = [
    { icon: "chat", onPress: props.onTalk, enabled: true },
    {
      icon:
        props.voiceState === "loading"
          ? "hourglass_empty"
          : props.voiceState === "playing"
            ? "stop"
            : "volume_up",
      onPress: props.onToggleVoice,
      enabled: props.canSample,
    },
    ...(props.showRegenerate
      ? [
          {
            icon: props.regenerating ? "hourglass_empty" : "refresh",
            onPress: props.onRegenerate,
            enabled: !props.regenerating,
          },
        ]
      : []),
  ];

  return (
    <Host colorScheme={props.isDark ? "dark" : "light"} style={styles.host}>
      <Row
        horizontalArrangement="center"
        verticalAlignment="center"
        modifiers={[fillMaxWidth(), height(68)]}
      >
        {actions.map((action, index) => (
          <Fragment key={`${action.icon}-${index}`}>
            {index > 0 ? <Spacer modifiers={[size(16, 1)]} /> : null}
            <FilledTonalIconButton
              onClick={action.onPress}
              enabled={action.enabled}
              colors={{
                containerColor: props.primaryForegroundColor,
                contentColor: props.foregroundColor,
              }}
              modifiers={[size(64, 64)]}
            >
              <Text
                color={props.foregroundColor}
                style={{ fontFamily: interfaceFontFamily.materialSymbols, fontSize: 28 }}
              >
                {action.icon}
              </Text>
            </FilledTonalIconButton>
          </Fragment>
        ))}
      </Row>
    </Host>
  );
}

const styles = StyleSheet.create({ host: { width: "100%", height: 68 } });
