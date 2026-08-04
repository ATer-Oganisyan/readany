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
  // React Native cannot read UIKit's intrinsicContentSize through ExpoView.
  // Reserve the measured label width plus the SF Symbol, gap and asymmetric
  // content insets so the native title never wraps.
  const width = Math.max(56, Math.ceil(label.length * 11.5) + 76);

  return (
    <View style={{ width, height: 56 }}>
      <NativeImportMenuButton
        label={label}
        urlLabel={urlLabel}
        localLabel={localLabel}
        color={colors.primary}
        foregroundColor={colors.primaryForeground}
        disabled={disabled}
        onUrlPress={onUrlPress}
        onLocalPress={onLocalPress}
        style={{ width, height: 56 }}
      />
    </View>
  );
}
