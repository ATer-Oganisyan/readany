import { useTheme } from "@/styles/theme";
import { Button } from "@expo/ui/jetpack-compose";
import { StyleSheet, View } from "react-native";
import {
  type NativeButtonIcon,
  type NativeButtonProps,
  type NativeButtonVariant,
  nativeButtonHeights,
} from "./NativeButton.types";

const icons: Record<NativeButtonIcon, string> = {
  add: "rounded.Add",
  back: "rounded.ArrowBack",
  forward: "rounded.ArrowForward",
  check: "rounded.Check",
  close: "rounded.Close",
  components: "rounded.Widgets",
  delete: "rounded.Delete",
  edit: "rounded.Edit",
  play: "rounded.PlayArrow",
  refresh: "rounded.Refresh",
  search: "rounded.Search",
  send: "rounded.Send",
  settings: "rounded.Settings",
  share: "rounded.Share",
};

const variants: Record<NativeButtonVariant, "default" | "bordered" | "borderless"> = {
  primary: "default",
  secondary: "bordered",
  tertiary: "borderless",
  destructive: "default",
};

export function NativeButton({
  label,
  onPress,
  variant = "primary",
  size = "medium",
  icon,
  disabled = false,
  fullWidth = false,
  accessibilityLabel,
  style,
  testID,
}: NativeButtonProps) {
  const { colors } = useTheme();
  const isPrimary = variant === "primary" || variant === "destructive";
  const accent = variant === "destructive" ? colors.destructive : colors.primary;
  const content = isPrimary
    ? variant === "destructive"
      ? colors.destructiveForeground
      : colors.primaryForeground
    : accent;

  return (
    <View
      style={[fullWidth ? styles.fullWidth : styles.intrinsic, style]}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      <Button
        onPress={onPress}
        disabled={disabled}
        variant={variants[variant]}
        leadingIcon={icon ? (icons[icon] as never) : undefined}
        style={{ width: fullWidth ? "100%" : undefined, minHeight: nativeButtonHeights[size] }}
        elementColors={{
          containerColor: isPrimary
            ? accent
            : variant === "secondary"
              ? colors.muted
              : "transparent",
          contentColor: content,
          disabledContainerColor: colors.muted,
          disabledContentColor: colors.mutedForeground,
        }}
      >
        {label}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  fullWidth: { alignSelf: "stretch" },
  intrinsic: { alignSelf: "flex-start" },
});

export type { NativeButtonProps } from "./NativeButton.types";
