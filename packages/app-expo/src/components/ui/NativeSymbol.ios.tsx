import { Host, Icon } from "@expo/ui";
import type { ComponentProps } from "react";
import type { NativeSymbolProps } from "./NativeSymbol.types";

export function NativeSymbol({ name, size = 24, color = "#8e8e93", style }: NativeSymbolProps) {
  return (
    <Host
      accessibilityElementsHidden
      ignoreSafeArea="all"
      importantForAccessibility="no"
      pointerEvents="none"
      style={[{ width: size, height: size }, style]}
    >
      <Icon name={name as ComponentProps<typeof Icon>["name"]} size={size} color={color} />
    </Host>
  );
}

export type { NativeSymbolProps } from "./NativeSymbol.types";
