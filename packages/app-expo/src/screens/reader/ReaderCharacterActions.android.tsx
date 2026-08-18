import { type MishanaerIconName, getStrokeIconImageSource } from "@/components/ui/MishanaerIcon";
import { FilledTonalIconButton, Host, Icon, Row, Spacer } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, height, size } from "@expo/ui/jetpack-compose/modifiers";
import { Fragment } from "react";
import { StyleSheet } from "react-native";
import type { ReaderCharacterActionsProps } from "./ReaderCharacterActions.types";

export function ReaderCharacterActions(props: ReaderCharacterActionsProps) {
  const actions = [
    { icon: "chat-bubble" as MishanaerIconName, onPress: props.onTalk, enabled: true },
    {
      icon:
        props.voiceState === "loading"
          ? "pulse-circle"
          : props.voiceState === "playing"
            ? "stop"
            : "volume-2",
      onPress: props.onToggleVoice,
      enabled: props.canSample,
    },
    ...(props.showRegenerate
      ? [
          {
            icon: props.regenerating ? "pulse-circle" : "repeat",
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
              <Icon
                source={getStrokeIconImageSource(action.icon as MishanaerIconName)}
                size={28}
                tint={props.foregroundColor}
                contentDescription={action.icon}
              />
            </FilledTonalIconButton>
          </Fragment>
        ))}
      </Row>
    </Host>
  );
}

const styles = StyleSheet.create({ host: { width: "100%", height: 68 } });
