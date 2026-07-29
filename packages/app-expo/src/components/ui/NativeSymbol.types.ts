import type { StyleProp, ViewStyle } from "react-native";

export interface NativeSymbolProps {
  name: string;
  fallback: string;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}
