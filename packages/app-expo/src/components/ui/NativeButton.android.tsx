import { interfaceFontFamily } from "@deslop/primitives/native";
import {
  Button,
  FilledTonalIconButton,
  Host,
  Icon,
  Text as ComposeText,
} from "@expo/ui/jetpack-compose";
import {
  fillMaxWidth,
  height,
  size as nativeSize,
  testID as nativeTestID,
} from "@expo/ui/jetpack-compose/modifiers";
import { getFilledIconImageSource, getStrokeIconImageSource } from "./MishanaerIcon";
import { MishanaerIcon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import { useTheme } from "@/styles/theme";
import { ActivityIndicator, Pressable, StyleSheet } from "react-native";
import {
  type NativeButtonProps,
  nativeButtonHeights,
  nativeButtonIconNames,
} from "./NativeButton.types";

export function NativeButton({
  label,
  nativeAppearance = false,
  onPress,
  variant = "primary",
  size = "medium",
  icon,
  iconOnly = false,
  colorScheme,
  disabled = false,
  loading = false,
  fullWidth = false,
  accessibilityLabel,
  style,
  testID,
}: NativeButtonProps) {
  const { colors, isDark } = useTheme();
  const isFilled = variant === "primary" || variant === "destructive";
  const accent = variant === "destructive" ? colors.destructive : colors.primary;
  const content = isFilled
    ? variant === "destructive"
      ? colors.destructiveForeground
      : colors.primaryForeground
    : variant === "glass"
      ? colors.foreground
      : accent;
  const buttonHeight = nativeButtonHeights[size];

  if (iconOnly && icon) {
    const dark = colorScheme ? colorScheme === "dark" : isDark;
    const foreground = dark ? "#ffffff" : "#000000";
    return (
      <Host colorScheme={dark ? "dark" : "light"} style={[{ width: 64, height: 68 }, style]}>
        <FilledTonalIconButton
          onClick={onPress}
          enabled={!disabled && !loading}
          colors={{ containerColor: dark ? "#ffffff20" : "#00000010", contentColor: foreground }}
          modifiers={[nativeSize(64, 64), ...(testID ? [nativeTestID(testID)] : [])]}
        >
          <Icon
            source={
              loading
                ? getStrokeIconImageSource("pulse-circle")
                : icon === "book" || icon === "play"
                  ? getFilledIconImageSource(icon)
                  : getStrokeIconImageSource(nativeButtonIconNames[icon])
            }
            size={28}
            tint={foreground}
            contentDescription={accessibilityLabel ?? label}
          />
        </FilledTonalIconButton>
      </Host>
    );
  }

  if (
    nativeAppearance &&
    (variant === "primary" || variant === "secondary" || variant === "glass") &&
    !icon
  ) {
    return (
      <Host
        matchContents={{ vertical: true }}
        colorScheme={isDark ? "dark" : "light"}
        style={[{ alignSelf: fullWidth ? "stretch" : "flex-start" }, style]}
      >
        <Button
          enabled={!disabled && !loading}
          onClick={onPress}
          colors={{
            containerColor: variant === "glass" ? colors.muted : accent,
            contentColor: variant === "glass" ? colors.foreground : colors.primaryForeground,
          }}
          modifiers={[
            height(buttonHeight),
            ...(fullWidth ? [fillMaxWidth()] : []),
            ...(testID ? [nativeTestID(testID)] : []),
          ]}
        >
          <ComposeText
            style={{ fontFamily: interfaceFontFamily.regular, fontSize: 16 }}
            maxLines={1}
          >
            {label}
          </ComposeText>
        </Button>
      </Host>
    );
  }

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
            : variant === "secondary" || variant === "glass"
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
          {icon ? (
            <MishanaerIcon name={nativeButtonIconNames[icon]} size={20} color={content} />
          ) : null}
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
