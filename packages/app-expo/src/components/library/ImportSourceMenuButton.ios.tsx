import {
  EMPTY_STATE_ACTION_HEIGHT,
  getEmptyStateMenuButtonWidth,
} from "@/components/ui/empty-state-action-metrics";
import { useTheme } from "@/styles/ThemeContext";
import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import { View } from "react-native";
import type { ImportSourceMenuButtonProps } from "./ImportSourceMenuButton.types";

interface NativeImportMenuButtonProps {
  label: string;
  localLabel: string;
  color: string;
  foregroundColor: string;
  disabled: boolean;
  showsMenu: boolean;
  onButtonPress: () => void;
  onLocalPress: () => void;
  style: { width: number; height: number };
}

const NativeImportMenuButton = requireNativeView(
  "ReadAnyNativeControls",
  "ReadAnyImportMenuButton",
) as ComponentType<NativeImportMenuButtonProps>;

export function ImportSourceMenuButton({
  label,
  localLabel,
  disabled = false,
  onLocalPress,
}: ImportSourceMenuButtonProps) {
  const { colors } = useTheme();
  const width = getEmptyStateMenuButtonWidth(label);

  return (
    <View style={{ width, height: EMPTY_STATE_ACTION_HEIGHT }}>
      <NativeImportMenuButton
        label={label}
        localLabel={localLabel}
        color={colors.primary}
        foregroundColor={colors.primaryForeground}
        disabled={disabled}
        showsMenu={false}
        onButtonPress={onLocalPress}
        onLocalPress={onLocalPress}
        style={{ width, height: EMPTY_STATE_ACTION_HEIGHT }}
      />
    </View>
  );
}
