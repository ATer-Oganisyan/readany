import { forwardRef } from "react";
import type {
  MorphTransitionDestinationHandle,
  MorphTransitionDestinationProps,
  MorphTransitionSourceProps,
} from "./MorphSheetTransition.types";

export function MorphTransitionSource({ children }: MorphTransitionSourceProps) {
  return children;
}

export const MorphTransitionDestination = forwardRef<
  MorphTransitionDestinationHandle,
  MorphTransitionDestinationProps
>(function MorphTransitionDestination(_props, _ref) {
  return null;
});

export type {
  MorphTransitionDestinationHandle,
  MorphTransitionDestinationProps,
  MorphTransitionSourceProps,
} from "./MorphSheetTransition.types";
