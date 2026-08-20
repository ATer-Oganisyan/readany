import type { PropsWithChildren } from "react";
import type { StyleProp, ViewProps, ViewStyle } from "react-native";

export type MorphTransitionSourceProps = PropsWithChildren<{
  sourceId?: string;
  style?: StyleProp<ViewStyle>;
  pointerEvents?: ViewProps["pointerEvents"];
}>;

export interface MorphTransitionDestinationProps {
  sourceId?: string;
}

export interface MorphTransitionDestinationHandle {
  expandSheet?: () => Promise<void>;
  collapseSheet?: () => Promise<void>;
}
