import type { StyleProp, ViewStyle } from "react-native";
import type { MishanaerIconName } from "./MishanaerIcon";

export type NativeButtonVariant = "primary" | "secondary" | "tertiary" | "destructive" | "glass";
export type NativeButtonSize = "small" | "medium" | "large";
export type NativeButtonIcon =
  | "book"
  | "add"
  | "appearance"
  | "back"
  | "forward"
  | "image"
  | "check"
  | "chat"
  | "close"
  | "components"
  | "delete"
  | "edit"
  | "headphones"
  | "play"
  | "more"
  | "refresh"
  | "search"
  | "send"
  | "settings"
  | "share"
  | "sparkles";

export const nativeButtonIconNames: Record<NativeButtonIcon, MishanaerIconName> = {
  book: "book",
  add: "plus",
  appearance: "text-t",
  back: "arrow-left",
  forward: "arrow-right",
  image: "image",
  check: "check",
  chat: "chat-bubble",
  close: "x",
  components: "grid-2x2",
  delete: "bin",
  edit: "pencil",
  headphones: "headphones",
  play: "play",
  more: "dots-three-horizontal",
  refresh: "repeat",
  search: "magnifying-glass",
  send: "arrow-block-up",
  settings: "gear",
  share: "share-network",
  sparkles: "sparkles",
};

export interface NativeButtonProps {
  /** Opt into the system control for a text-only primary, secondary, or glass action. */
  nativeAppearance?: boolean;
  colorScheme?: "light" | "dark";
  label: string;
  onPress: () => void;
  variant?: NativeButtonVariant;
  size?: NativeButtonSize;
  icon?: NativeButtonIcon;
  /** Circular 64 pt action, matching the character profile controls. */
  iconOnly?: boolean;
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
