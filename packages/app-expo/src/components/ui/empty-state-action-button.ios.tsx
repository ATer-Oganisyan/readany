import { useTheme } from "@/styles/ThemeContext";
import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import { View } from "react-native";
import type { EmptyStateActionButtonProps } from "./empty-state-action-button";
import {
  EMPTY_STATE_ACTION_HEIGHT,
  getEmptyStateActionWidth,
  getEmptyStateMenuButtonWidth,
} from "./empty-state-action-metrics";

interface NativeEmptyStateActionButtonProps {
  label: string;
  color: string;
  foregroundColor: string;
  disabled: boolean;
  showsMenu: boolean;
  showsPlus: boolean;
  onButtonPress: () => void;
  style: { width: number; height: number };
}

const NativeEmptyStateActionButton = requireNativeView(
  "ReadAnyNativeControls",
  "ReadAnyImportMenuButton",
) as ComponentType<NativeEmptyStateActionButtonProps>;

/** Direct action rendered by the same UIKit control as the library import menu. */
export function EmptyStateActionButton({
  label,
  disabled = false,
  showPlus = false,
  onPress,
}: EmptyStateActionButtonProps) {
  const { colors } = useTheme();
  const width = showPlus ? getEmptyStateActionWidth(label) : getEmptyStateMenuButtonWidth(label);

  return (
    <View style={{ width, height: EMPTY_STATE_ACTION_HEIGHT }}>
      <NativeEmptyStateActionButton
        label={label}
        color={colors.primary}
        foregroundColor={colors.primaryForeground}
        disabled={disabled}
        showsMenu={false}
        showsPlus={showPlus}
        onButtonPress={onPress}
        style={{ width, height: EMPTY_STATE_ACTION_HEIGHT }}
      />
    </View>
  );
}

export type { EmptyStateActionButtonProps } from "./empty-state-action-button";
