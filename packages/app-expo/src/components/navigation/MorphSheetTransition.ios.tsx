import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import { StyleSheet, type ViewProps } from "react-native";
import type {
  MorphTransitionDestinationProps,
  MorphTransitionSourceProps,
} from "./MorphSheetTransition.types";

interface NativeSourceProps extends MorphTransitionSourceProps, Pick<ViewProps, "collapsable"> {
  sourceId: string;
}

interface NativeDestinationProps extends ViewProps {
  sourceId: string;
  style: typeof styles.destination;
}

const NativeSource = requireNativeView(
  "MorphSheetTransition",
  "MorphTransitionSourceView",
) as ComponentType<NativeSourceProps>;

const NativeDestination = requireNativeView(
  "MorphSheetTransition",
  "MorphTransitionDestinationView",
) as ComponentType<NativeDestinationProps>;

export function MorphTransitionSource({
  sourceId = "",
  style,
  children,
}: MorphTransitionSourceProps) {
  return (
    <NativeSource collapsable={false} sourceId={sourceId} style={style}>
      {children}
    </NativeSource>
  );
}

export function MorphTransitionDestination({ sourceId = "" }: MorphTransitionDestinationProps) {
  return (
    <NativeDestination
      collapsable={false}
      pointerEvents="none"
      sourceId={sourceId}
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

export type {
  MorphTransitionDestinationProps,
  MorphTransitionSourceProps,
} from "./MorphSheetTransition.types";
