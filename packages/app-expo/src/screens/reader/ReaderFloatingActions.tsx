import { BotIcon, HeadphonesIcon, LanguagesIcon } from "@/components/ui/Icon";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import type { ReaderFloatingActionsProps } from "./ReaderFloatingActions.types";

export function ReaderFloatingActions(props: ReaderFloatingActionsProps) {
  const actions = [
    {
      key: "translate",
      icon: <LanguagesIcon size={18} color="#fff" />,
      active: props.translationActive,
      onPress: props.onTranslate,
    },
    {
      key: "speech",
      icon: <HeadphonesIcon size={20} color="#fff" />,
      active: props.speechActive,
      onPress: props.onSpeech,
    },
    {
      key: "chat",
      icon: <BotIcon size={20} color="#fff" />,
      active: false,
      onPress: props.onChat,
    },
  ];
  return (
    <View style={styles.stack}>
      {actions.map((action) => (
        <TouchableOpacity
          key={action.key}
          style={[styles.button, action.active && { backgroundColor: props.accentColor }]}
          onPress={action.onPress}
        >
          {action.icon}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10, alignItems: "center" },
  button: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(76, 82, 94, 0.88)",
  },
});

export type { ReaderFloatingActionsProps } from "./ReaderFloatingActions.types";
