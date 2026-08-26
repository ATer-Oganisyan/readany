import { MishanaerIcon, resolveSystemIconName } from "./MishanaerIcon";
import type { NativeSymbolProps } from "./NativeSymbol.types";

export function NativeSymbol({ name, variant, size, color, style }: NativeSymbolProps) {
  return (
    <MishanaerIcon
      name={resolveSystemIconName(name)}
      variant={variant}
      size={size}
      color={color}
      style={style}
    />
  );
}

export type { NativeSymbolProps } from "./NativeSymbol.types";
