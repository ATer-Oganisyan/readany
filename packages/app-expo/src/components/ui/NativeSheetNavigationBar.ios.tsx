import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import type { NativeSyntheticEvent } from "react-native";
import type { NativeSheetNavigationBarProps } from "./NativeSheetNavigationBar.types";

type NativeProps = Omit<NativeSheetNavigationBarProps, "onMenuItemPress"> & {
  onMenuItemPress?: (event: NativeSyntheticEvent<{ key: string }>) => void;
};

const NativeView = requireNativeView(
  "ReadAnyNativeControls",
  "ReadAnySheetNavigationBar",
) as ComponentType<NativeProps>;

/** UIKit navigation bar for sheets: a bar laid over the content, outside the sheet's layout. */
export function NativeSheetNavigationBar({
  onMenuItemPress,
  ...props
}: NativeSheetNavigationBarProps) {
  return (
    <NativeView
      {...props}
      onMenuItemPress={
        onMenuItemPress ? (event) => onMenuItemPress(event.nativeEvent.key) : undefined
      }
    />
  );
}

export type {
  NativeSheetMenuSection,
  NativeSheetNavigationBarProps,
} from "./NativeSheetNavigationBar.types";
