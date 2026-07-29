import type { ComponentType } from "react";
import { type ViewProps, requireNativeComponent } from "react-native";
import type { NativeSymbolProps } from "./NativeSymbol.types";

interface ReadAnyNativeSymbolViewProps extends ViewProps {
  name: string;
  size: number;
  color: string;
}

const nativeSymbolRegistry = globalThis as typeof globalThis & {
  __readAnyNativeSymbolView?: ComponentType<ReadAnyNativeSymbolViewProps>;
};

const ReadAnyNativeSymbolView =
  nativeSymbolRegistry.__readAnyNativeSymbolView ??
  requireNativeComponent<ReadAnyNativeSymbolViewProps>("ReadAnyNativeSymbol");

nativeSymbolRegistry.__readAnyNativeSymbolView = ReadAnyNativeSymbolView;

export function NativeSymbol({ name, size = 24, color = "#8e8e93", style }: NativeSymbolProps) {
  return (
    <ReadAnyNativeSymbolView
      name={name}
      size={size}
      color={color}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[{ width: size, height: size }, style]}
    />
  );
}

export type { NativeSymbolProps } from "./NativeSymbol.types";
