import { interfaceFontFamily } from "@deslop/primitives/native";
import { Button, Host, Text as SwiftText } from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  accessibilityLabel as nativeLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as nativeDisabled,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  labelStyle,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { HostedMishanaerIcon } from "./HostedMishanaerIcon";
import { MishanaerIcon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import { useTheme } from "@/styles/theme";
import { ActivityIndicator, Platform, Pressable, StyleSheet } from "react-native";
import {
  type NativeButtonProps,
  nativeButtonHeights,
  nativeButtonIconNames,
} from "./NativeButton.types";

export function NativeButton({
  label,
  nativeAppearance = false,
  colorScheme,
  onPress,
  variant = "primary",
  size = "medium",
  icon,
  iconOnly = false,
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
  const regularGlass =
    (variant === "secondary" || variant === "glass") &&
    Number.parseInt(String(Platform.Version), 10) >= 26;

  if (iconOnly && icon) {
    const dark = colorScheme ? colorScheme === "dark" : isDark;
    const foreground = dark ? "#ffffff" : "#000000";
    return (
      <Host colorScheme={dark ? "dark" : "light"} style={[{ width: 64, height: 68 }, style]}>
        <Button
          onPress={onPress}
          modifiers={[
            buttonStyle(regularGlass ? "plain" : "bordered"),
            controlSize("extraLarge"),
            labelStyle("iconOnly"),
            frame({ width: 64, height: 64 }),
            ...(regularGlass
              ? [glassEffect({ glass: { variant: "regular", interactive: true }, shape: "circle" })]
              : []),
            tint(foreground),
            nativeDisabled(disabled || loading),
            nativeLabel(accessibilityLabel ?? label),
            ...(testID ? [accessibilityIdentifier(testID)] : []),
          ]}
        >
          <HostedMishanaerIcon
            name={loading ? "pulse-circle" : nativeButtonIconNames[icon]}
            variant="filled"
            size={28}
            box={64}
            color={foreground}
          />
        </Button>
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
        matchContents={{ vertical: true, horizontal: !fullWidth }}
        colorScheme={colorScheme ?? (isDark ? "dark" : "light")}
        style={[{ alignSelf: fullWidth ? "stretch" : "flex-start" }, style]}
      >
        <Button
          onPress={onPress}
          modifiers={[
            buttonStyle(
              Number.parseInt(String(Platform.Version), 10) >= 26
                ? variant === "secondary" || variant === "glass"
                  ? "plain"
                  : "glassProminent"
                : variant === "glass"
                  ? "bordered"
                  : "borderedProminent",
            ),
            buttonBorderShape("capsule"),
            controlSize("large"),
            ...(variant === "glass" ? [] : [tint(accent)]),
            ...(regularGlass
              ? [
                  glassEffect({
                    glass: {
                      variant: "regular",
                      ...(variant === "glass" ? {} : { tint: accent }),
                      interactive: true,
                    },
                    shape: "capsule",
                  }),
                ]
              : []),
            nativeDisabled(disabled || loading),
            nativeLabel(accessibilityLabel ?? label),
            ...(testID ? [accessibilityIdentifier(testID)] : []),
          ]}
        >
          <SwiftText
            modifiers={[
              font({ family: interfaceFontFamily.regular, size: 16 }),
              variant === "glass"
                ? foregroundStyle({ type: "hierarchical", style: "primary" })
                : foregroundStyle(colors.primaryForeground),
              ...(regularGlass && !fullWidth ? [padding({ horizontal: 18 })] : []),
              frame({
                maxWidth: fullWidth ? 10_000 : undefined,
                minHeight: regularGlass ? buttonHeight : buttonHeight - 24,
              }),
            ]}
          >
            {label}
          </SwiftText>
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
