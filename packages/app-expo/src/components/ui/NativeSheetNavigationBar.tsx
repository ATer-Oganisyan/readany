import type { NativeSheetNavigationBarProps } from "./NativeSheetNavigationBar.types";

/** iOS only; other platforms draw their own sheet chrome. */
export function NativeSheetNavigationBar(_props: NativeSheetNavigationBarProps) {
  return null;
}

export type {
  NativeSheetMenuSection,
  NativeSheetNavigationBarProps,
} from "./NativeSheetNavigationBar.types";
