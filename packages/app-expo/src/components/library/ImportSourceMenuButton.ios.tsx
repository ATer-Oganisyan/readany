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
  urlLabel: string;
  localLabel: string;
  color: string;
  foregroundColor: string;
  disabled: boolean;
  showsMenu: boolean;
  onUrlPress: () => void;
  onLocalPress: () => void;
  style: { width: number; height: number };
}

const NativeImportMenuButton = requireNativeView(
  "ReadAnyNativeControls",
  "ReadAnyImportMenuButton",
) as ComponentType<NativeImportMenuButtonProps>;

export function ImportSourceMenuButton({
  label,
  urlLabel,
  localLabel,
  disabled = false,
  onUrlPress,
  onLocalPress,
}: ImportSourceMenuButtonProps) {
  const { colors } = useTheme();
  const width = getEmptyStateMenuButtonWidth(label);

  return (
    <View style={{ width, height: EMPTY_STATE_ACTION_HEIGHT }}>
      <NativeImportMenuButton
        label={label}
        urlLabel={urlLabel}
        localLabel={localLabel}
        color={colors.primary}
        foregroundColor={colors.primaryForeground}
        disabled={disabled}
        showsMenu
        onUrlPress={onUrlPress}
        onLocalPress={onLocalPress}
        style={{ width, height: EMPTY_STATE_ACTION_HEIGHT }}
      />
    </View>
  );
}
