import type { StyleProp, ViewStyle } from "react-native";

export type NativeButtonVariant = "primary" | "secondary" | "tertiary" | "destructive";
export type NativeButtonSize = "small" | "medium" | "large";
export type NativeButtonIcon =
  | "add"
  | "back"
  | "forward"
  | "image"
  | "check"
  | "chat"
  | "close"
  | "components"
  | "delete"
  | "edit"
  | "play"
  | "refresh"
  | "search"
  | "send"
  | "settings"
  | "share";

export interface NativeButtonProps {
  label: string;
  onPress: () => void;
  variant?: NativeButtonVariant;
  size?: NativeButtonSize;
  icon?: NativeButtonIcon;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const nativeButtonHeights: Record<NativeButtonSize, number> = {
  small: 36,
  medium: 44,
  large: 52,
};
