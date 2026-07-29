import type { StyleProp, TextStyle } from "react-native";
import { MaterialIcon } from "./Icon";
import type { NativeSymbolProps } from "./NativeSymbol.types";

export function NativeSymbol({ fallback, size, color, style }: NativeSymbolProps) {
  return (
    <MaterialIcon name={fallback} size={size} color={color} style={style as StyleProp<TextStyle>} />
  );
}

export type { NativeSymbolProps } from "./NativeSymbol.types";
