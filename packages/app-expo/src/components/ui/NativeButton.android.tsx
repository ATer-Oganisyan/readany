import { useTheme } from "@/styles/theme";
import { interfaceFontFamily } from "@deslop/primitives/native";
import {
  Button,
  CircularProgressIndicator,
  Text as ComposeText,
  Host,
  OutlinedButton,
  Spacer,
  TextButton,
} from "@expo/ui/jetpack-compose";
import { size as composeSize, fillMaxWidth, height } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet, View } from "react-native";
import {
  type NativeButtonIcon,
  type NativeButtonProps,
  type NativeButtonVariant,
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
};

const variants: Record<NativeButtonVariant, typeof Button> = {
  primary: Button,
  secondary: OutlinedButton,
  tertiary: TextButton,
  destructive: Button,
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
  const isPrimary = variant === "primary" || variant === "destructive";
  const accent = variant === "destructive" ? colors.destructive : colors.primary;
  const content = isPrimary
    ? variant === "destructive"
      ? colors.destructiveForeground
      : colors.primaryForeground
    : accent;
  const ButtonComponent = variants[variant];
  const buttonHeight = nativeButtonHeights[size];

  return (
    <View
      style={[fullWidth ? styles.fullWidth : styles.intrinsic, style]}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      <Host
        matchContents={fullWidth ? { vertical: true } : true}
        style={fullWidth ? styles.fullWidth : undefined}
      >
        <ButtonComponent
          onClick={onPress}
          enabled={!disabled && !loading}
          modifiers={[height(buttonHeight), ...(fullWidth ? [fillMaxWidth()] : [])]}
          contentPadding={{ start: 16, end: icon ? 24 : 16, top: 0, bottom: 0 }}
          colors={{
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
          {loading ? (
            <CircularProgressIndicator
              color={content}
              modifiers={[composeSize(20, 20)]}
              strokeWidth={2.5}
            />
          ) : icon ? (
            <>
              <ComposeText
                color={content}
                style={{ fontFamily: interfaceFontFamily.materialSymbols, fontSize: 20 }}
              >
                {icons[icon]}
              </ComposeText>
              <Spacer modifiers={[composeSize(8, 1)]} />
            </>
          ) : null}
          {loading ? null : (
            <ComposeText
              color={content}
              maxLines={1}
              softWrap={false}
              overflow="ellipsis"
              style={{ fontFamily: interfaceFontFamily.semibold, typography: "labelLarge" }}
            >
              {label}
            </ComposeText>
          )}
        </ButtonComponent>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  fullWidth: { alignSelf: "stretch" },
  intrinsic: { alignSelf: "flex-start" },
});

export type { NativeButtonProps } from "./NativeButton.types";
