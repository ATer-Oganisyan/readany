import { requireNativeModule, requireNativeView } from "expo";
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";

export const SystemSheetZoomSource = requireNativeView(
  "ReadAnyNativeControls",
  "SystemSheetZoomSourceView",
) as ComponentType<ViewProps & { sourceId: string }>;

export function prepareSheetZoom(sourceId: string): Promise<void> {
  return requireNativeModule("ReadAnyNativeControls").prepareSheetZoom(sourceId);
}
