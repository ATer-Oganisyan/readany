import { requireNativeModule, requireNativeView } from "expo";
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";

export const SystemSheetZoomSource = requireNativeView(
  "ReadAnyNativeControls",
  "SystemSheetZoomSourceView",
) as ComponentType<ViewProps & { sourceId: string; onZoomReturn?: () => void }>;

export async function prepareSheetZoom(sourceId: string): Promise<void> {
  // Older development clients can open the sheet without preparing the zoom.
  await requireNativeModule("ReadAnyNativeControls").prepareSheetZoom?.(sourceId);
}
