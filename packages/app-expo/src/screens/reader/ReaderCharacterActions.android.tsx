import {
  type MishanaerIconName,
  getFilledIconImageSource,
  getStrokeIconImageSource,
} from "@/components/ui/MishanaerIcon";
import { FilledTonalIconButton, Host, Icon, Row, Spacer } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, height, size } from "@expo/ui/jetpack-compose/modifiers";
import { BlurView } from "expo-blur";
import { Fragment } from "react";
import { StyleSheet, View } from "react-native";
import type { ReaderCharacterActionsProps } from "./ReaderCharacterActions.types";

function getActionIconSource(icon: MishanaerIconName) {
  if (
    icon === "chat-bubble" ||
    icon === "headphones" ||
    icon === "stop" ||
    icon === "arrow-rotate-ccw-up"
  ) {
    return getFilledIconImageSource(icon);
  }
  return getStrokeIconImageSource(icon);
}

export function ReaderCharacterActions(props: ReaderCharacterActionsProps) {
  const actions = [
    { icon: "chat-bubble" as MishanaerIconName, onPress: props.onTalk, enabled: true },
    {
      icon:
        props.voiceState === "loading"
          ? "pulse-circle"
          : props.voiceState === "playing"
            ? "stop"
            : "headphones",
      onPress: props.onToggleVoice,
      enabled: props.canSample,
    },
    ...(props.showRegenerate
      ? [
          {
            // Иконка не меняется во время генерации: ожидание показывает шиммер портрета.
            icon: "arrow-rotate-ccw-up",
            onPress: props.onRegenerate,
            enabled: !props.regenerating,
          },
        ]
      : []),
  ];

  return (
    <View style={styles.host}>
      {props.blurTarget ? (
        <View pointerEvents="none" style={styles.blurRow}>
          {actions.map((action) => (
            <View key={action.icon} style={styles.blurCircle}>
              <BlurView
                blurTarget={props.blurTarget}
                blurMethod="dimezisBlurViewSdk31Plus"
                intensity={45}
                tint={props.isDark ? "dark" : "light"}
                style={StyleSheet.absoluteFill}
              />
            </View>
          ))}
        </View>
      ) : null}
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
                  source={getActionIconSource(action.icon as MishanaerIconName)}
                  size={28}
                  tint={props.foregroundColor}
                  contentDescription={action.icon}
                />
              </FilledTonalIconButton>
            </Fragment>
          ))}
        </Row>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { width: "100%", height: 68 },
  blurRow: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  blurCircle: { width: 64, height: 64, borderRadius: 32, overflow: "hidden" },
});
