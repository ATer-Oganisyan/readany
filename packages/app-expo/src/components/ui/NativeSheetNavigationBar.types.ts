import type { StyleProp, ViewStyle } from "react-native";

export interface NativeSheetMenuSection {
  title: string;
  items: Array<{ key: string; label: string; checked: boolean }>;
}

export interface NativeSheetNavigationBarProps {
  isDark: boolean;
  title?: string;
  closeAccessibilityLabel?: string;
  onClosePress?: () => void;
  /** Defaults to true. */
  showsCloseButton?: boolean;
  /** Let the sheet's colour show through instead of a solid bar. */
  transparentBackground?: boolean;
  /** Non-empty adds a "More" button with these inline groups of choices. */
  menuSections?: NativeSheetMenuSection[];
  menuAccessibilityLabel?: string;
  onMenuItemPress?: (key: string) => void;
  style?: StyleProp<ViewStyle>;
}
