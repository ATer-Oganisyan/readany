import type { StyleProp, ViewStyle } from "react-native";

export interface NativeSymbolProps {
  name: string;
  fallback: string;
  variant?: "stroke" | "filled";
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}
