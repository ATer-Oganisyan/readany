import { useTheme } from "@/styles/theme";
import { Pressable, StyleSheet } from "react-native";
import { type NativeButtonProps, nativeButtonHeights } from "./NativeButton.types";
import { Text } from "./Typography";

/** Web fallback. iOS and Android resolve their platform-native implementations. */
export function NativeButton({
  label,
  onPress,
  variant = "primary",
  size = "medium",
  disabled = false,
  fullWidth = false,
  accessibilityLabel,
  style,
  testID,
}: NativeButtonProps) {
  const { colors } = useTheme();
  const isFilled = variant === "primary" || variant === "destructive";
  const accent = variant === "destructive" ? colors.destructive : colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: nativeButtonHeights[size],
          alignSelf: fullWidth ? "stretch" : "flex-start",
          backgroundColor: isFilled
            ? accent
            : variant === "secondary"
              ? colors.muted
              : "transparent",
          borderColor: variant === "secondary" ? colors.border : "transparent",
          opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
        },
        style,
      ]}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        ellipsizeMode="tail"
        style={{ color: isFilled ? colors.primaryForeground : accent, fontWeight: "600" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 18,
  },
});

export type { NativeButtonProps } from "./NativeButton.types";
