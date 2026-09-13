import { MishanaerIcon } from "./MishanaerIcon";
import { useTheme } from "@/styles/theme";
import { ActivityIndicator, Pressable, StyleSheet } from "react-native";
import {
  type NativeButtonProps,
  nativeButtonHeights,
  nativeButtonIconNames,
} from "./NativeButton.types";
import { Text } from "./Typography";

/** Web fallback. iOS and Android resolve their platform-native implementations. */
export function NativeButton({
  label,
  icon,
  iconOnly = false,
  onPress,
  variant = "primary",
  size = "medium",
  disabled = false,
  loading = false,
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
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: iconOnly ? 64 : nativeButtonHeights[size],
          ...(iconOnly ? { width: 64, height: 64, paddingHorizontal: 0 } : {}),
          alignSelf: fullWidth ? "stretch" : "flex-start",
          backgroundColor: isFilled
            ? accent
            : variant === "secondary" || variant === "glass"
              ? colors.muted
              : "transparent",
          borderColor:
            variant === "secondary" || variant === "glass" ? colors.border : "transparent",
          opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={
            isFilled ? colors.primaryForeground : variant === "glass" ? colors.foreground : accent
          }
        />
      ) : iconOnly && icon ? (
        <MishanaerIcon
          name={nativeButtonIconNames[icon]}
          variant="filled"
          size={28}
          color={colors.foreground}
        />
      ) : (
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          ellipsizeMode="tail"
          style={{
            color: isFilled
              ? colors.primaryForeground
              : variant === "glass"
                ? colors.foreground
                : accent,
            fontWeight: "600",
          }}
        >
          {label}
        </Text>
      )}
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
