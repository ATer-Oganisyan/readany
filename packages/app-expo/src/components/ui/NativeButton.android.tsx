import { MaterialIcon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import { useTheme } from "@/styles/theme";
import { ActivityIndicator, Pressable, StyleSheet } from "react-native";
import {
  type NativeButtonIcon,
  type NativeButtonProps,
  nativeButtonHeights,
} from "./NativeButton.types";

const icons: Record<NativeButtonIcon, string> = {
  add: "add",
  back: "arrow_back",
  forward: "arrow_forward",
  image: "add_photo_alternate",
  check: "check",
  chat: "chat",
  close: "close",
  components: "apps",
  delete: "delete",
  edit: "edit",
  play: "play_arrow",
  refresh: "refresh",
  search: "search",
  send: "send",
  settings: "settings",
  share: "share",
  sparkles: "auto_awesome",
};

export function NativeButton({
  label,
  onPress,
  variant = "primary",
  size = "medium",
  icon,
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
  const content = isFilled
    ? variant === "destructive"
      ? colors.destructiveForeground
      : colors.primaryForeground
    : accent;
  const buttonHeight = nativeButtonHeights[size];

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
          minHeight: buttonHeight,
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
      {loading ? (
        <ActivityIndicator color={content} />
      ) : (
        <>
          {icon ? <MaterialIcon name={icons[icon]} size={20} color={content} /> : null}
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            ellipsizeMode="tail"
            style={[styles.label, { color: content }]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 18,
  },
  label: { fontWeight: "600" },
});

export type { NativeButtonProps } from "./NativeButton.types";
