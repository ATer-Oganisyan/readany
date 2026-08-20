import type { PropsWithChildren } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export type MorphTransitionSourceProps = PropsWithChildren<{
  sourceId?: string;
  style?: StyleProp<ViewStyle>;
}>;

export interface MorphTransitionDestinationProps {
  sourceId?: string;
}
