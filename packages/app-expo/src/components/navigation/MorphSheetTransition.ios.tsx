import { requireNativeView } from "expo";
import { type ComponentType, forwardRef } from "react";
import { StyleSheet, type ViewProps } from "react-native";
import type {
  MorphTransitionDestinationHandle,
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
) as ComponentType<NativeDestinationProps & { ref?: React.Ref<MorphTransitionDestinationHandle> }>;

export function MorphTransitionSource({
  sourceId = "",
  style,
  pointerEvents,
  children,
}: MorphTransitionSourceProps) {
  return (
    <NativeSource
      collapsable={false}
      pointerEvents={pointerEvents}
      sourceId={sourceId}
      style={style}
    >
      {children}
    </NativeSource>
  );
}

export const MorphTransitionDestination = forwardRef<
  MorphTransitionDestinationHandle,
  MorphTransitionDestinationProps
>(function MorphTransitionDestination({ sourceId = "" }, ref) {
  return (
    <NativeDestination
      ref={ref}
      collapsable={false}
      pointerEvents="none"
      sourceId={sourceId}
      style={styles.destination}
    />
  );
});

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
  MorphTransitionDestinationHandle,
  MorphTransitionDestinationProps,
  MorphTransitionSourceProps,
} from "./MorphSheetTransition.types";
