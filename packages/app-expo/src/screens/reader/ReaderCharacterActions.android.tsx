import { FilledTonalIconButton, Host, Icon, Row, Spacer } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, height, size } from "@expo/ui/jetpack-compose/modifiers";
import { Fragment } from "react";
import { StyleSheet } from "react-native";
import type { ReaderCharacterActionsProps } from "./ReaderCharacterActions.types";

const iconSources = {
  chat: require("../../platform/android/reader/character-action-icons/chat.xml"),
  hourglass: require("../../platform/android/reader/character-action-icons/hourglass.xml"),
  refresh: require("../../platform/android/reader/character-action-icons/refresh.xml"),
  stop: require("../../platform/android/reader/character-action-icons/stop.xml"),
  volumeUp: require("../../platform/android/reader/character-action-icons/volume-up.xml"),
} as const;

export function ReaderCharacterActions(props: ReaderCharacterActionsProps) {
  const actions = [
    {
      icon: iconSources.chat,
      label: props.talkLabel,
      onPress: props.onTalk,
      enabled: true,
    },
    {
      icon:
        props.voiceState === "loading"
          ? iconSources.hourglass
          : props.voiceState === "playing"
            ? iconSources.stop
            : iconSources.volumeUp,
      label: props.voiceState === "idle" ? props.listenLabel : props.stopLabel,
      onPress: props.onToggleVoice,
      enabled: props.canSample,
    },
    ...(props.showRegenerate
      ? [
          {
            icon: props.regenerating ? iconSources.hourglass : iconSources.refresh,
            label: props.regenerateLabel,
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
          <Fragment key={`${action.label}-${index}`}>
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
                source={action.icon}
                tint={props.foregroundColor}
                size={28}
                contentDescription={action.label}
              />
            </FilledTonalIconButton>
          </Fragment>
        ))}
      </Row>
    </Host>
  );
}

const styles = StyleSheet.create({ host: { width: "100%", height: 68 } });
