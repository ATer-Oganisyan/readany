import { RotateCcwIcon, Volume2Icon } from "@/components/ui/Icon";
import { Pressable, StyleSheet, View } from "react-native";
import type { SceneToolbarProps } from "./SceneToolbar.types";

export const SCENE_TOOLBAR_HEIGHT = 50;

export function SceneToolbar({
  tintColor,
  speechActive,
  speechDisabled,
  regenerateDisabled,
  onSpeechPress,
  onRegeneratePress,
}: SceneToolbarProps) {
  return (
    <View style={styles.toolbar}>
      <Pressable
        accessibilityLabel={speechActive ? "Остановить озвучку" : "Озвучить по ролям"}
        accessibilityRole="button"
        disabled={speechDisabled}
        hitSlop={8}
        onPress={onSpeechPress}
        style={({ pressed }) => [styles.button, (pressed || speechDisabled) && styles.dimmed]}
      >
        <Volume2Icon color={tintColor} size={23} />
      </Pressable>
      <Pressable
        accessibilityLabel="Нарисовать заново"
        accessibilityRole="button"
        disabled={regenerateDisabled}
        hitSlop={8}
        onPress={onRegeneratePress}
        style={({ pressed }) => [styles.button, (pressed || regenerateDisabled) && styles.dimmed]}
      >
        <RotateCcwIcon color={tintColor} size={23} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    width: "100%",
    height: SCENE_TOOLBAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  button: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dimmed: { opacity: 0.4 },
});

export type { SceneToolbarProps } from "./SceneToolbar.types";
