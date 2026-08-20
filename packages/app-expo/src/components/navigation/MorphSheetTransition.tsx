import type {
  MorphTransitionDestinationProps,
  MorphTransitionSourceProps,
} from "./MorphSheetTransition.types";

export function MorphTransitionSource({ children }: MorphTransitionSourceProps) {
  return children;
}

export function MorphTransitionDestination(_props: MorphTransitionDestinationProps) {
  return null;
}

export type {
  MorphTransitionDestinationProps,
  MorphTransitionSourceProps,
} from "./MorphSheetTransition.types";
