import type { StyleProp, ViewStyle } from "react-native";
import type { MishanaerIconName } from "./MishanaerIcon";

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
  | "share"
  | "sparkles";

export const nativeButtonIconNames: Record<NativeButtonIcon, MishanaerIconName> = {
  add: "plus",
  back: "arrow-left",
  forward: "arrow-right",
  image: "image",
  check: "check",
  chat: "chat-bubble",
  close: "x",
  components: "grid-2x2",
  delete: "bin",
  edit: "pencil",
  play: "play",
  refresh: "repeat",
  search: "magnifying-glass",
  send: "arrow-block-up",
  settings: "gear",
  share: "share-network",
  sparkles: "sparkles",
};

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
