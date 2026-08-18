import { MishanaerIcon, resolveSystemIconName } from "./MishanaerIcon";
import type { NativeSymbolProps } from "./NativeSymbol.types";

export function NativeSymbol({ name, size = 24, color = "#8e8e93", style }: NativeSymbolProps) {
  return (
    <MishanaerIcon name={resolveSystemIconName(name)} size={size} color={color} style={style} />
  );
}

export type { NativeSymbolProps } from "./NativeSymbol.types";
