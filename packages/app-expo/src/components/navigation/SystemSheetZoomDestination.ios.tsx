import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import { StyleSheet, type ViewProps } from "react-native";

export interface SystemSheetZoomDestinationProps {
  sourceId?: string;
  expanded: boolean;
}

interface NativeDestinationProps extends ViewProps {
  sourceId: string;
  expanded: boolean;
}

const NativeDestination = requireNativeView(
  "ReadAnyNativeControls",
  "SystemSheetZoomDestinationView",
) as ComponentType<NativeDestinationProps>;

export function SystemSheetZoomDestination({
  sourceId = "",
  expanded,
}: SystemSheetZoomDestinationProps) {
  return (
    <NativeDestination
      collapsable={false}
      pointerEvents="none"
      sourceId={sourceId}
      expanded={expanded}
      style={styles.destination}
    />
  );
}

const styles = StyleSheet.create({
  destination: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
});
