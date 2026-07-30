import { useTheme } from "@/styles/theme";
import type { ComponentType } from "react";
import { UIManager, View, requireNativeComponent } from "react-native";
import {
  type NativeButtonIcon,
  type NativeButtonProps,
  type NativeButtonVariant,
  nativeButtonHeights,
} from "./NativeButton.types";

const icons: Record<NativeButtonIcon, string> = {
  add: "plus",
  back: "chevron.backward",
  forward: "chevron.forward",
  check: "checkmark",
  chat: "message",
  close: "xmark",
  components: "square.grid.2x2",
  delete: "trash",
  edit: "pencil",
  play: "play.fill",
  refresh: "arrow.clockwise",
  search: "magnifyingglass",
  send: "paperplane.fill",
  settings: "gearshape",
  share: "square.and.arrow.up",
};

interface ReadAnyNativeButtonViewProps {
  label: string;
  icon?: string;
  variant: NativeButtonVariant;
  color: string;
  foregroundColor: string;
  disabled: boolean;
  accessibilityLabel?: string;
  testID?: string;
  onPress: () => void;
  style: { width: number | `${number}%`; height: number };
}

const nativeButtonRegistry = globalThis as typeof globalThis & {
  __readAnyNativeButtonView?: ComponentType<ReadAnyNativeButtonViewProps>;
};

const ReadAnyNativeButtonView =
  nativeButtonRegistry.__readAnyNativeButtonView ??
  requireNativeComponent<ReadAnyNativeButtonViewProps>("ReadAnyNativeButton");

nativeButtonRegistry.__readAnyNativeButtonView = ReadAnyNativeButtonView;

const nativeButtonConfig = UIManager.getViewManagerConfig("ReadAnyNativeButton") as {
  NativeProps?: Record<string, unknown>;
} | null;
const supportsForegroundColor = Boolean(nativeButtonConfig?.NativeProps?.foregroundColor);

export function NativeButton({
  label,
  onPress,
  variant = "primary",
  size = "medium",
  icon,
  disabled = false,
  fullWidth = false,
  accessibilityLabel,
  style,
  testID,
}: NativeButtonProps) {
  const { colors, isDark } = useTheme();
  const height = nativeButtonHeights[size];
  const color =
    variant === "destructive"
      ? colors.destructive
      : variant === "primary" && isDark && !supportsForegroundColor
        ? colors.elevation2
        : colors.primary;
  const foregroundColor =
    variant === "destructive"
      ? colors.destructiveForeground
      : variant === "primary"
        ? colors.primaryForeground
        : color;
  const estimatedWidth = Math.max(
    height,
    Math.ceil(label.length * (size === "large" ? 9.5 : size === "small" ? 7.5 : 8.5)) +
      (icon ? 58 : 34),
  );

  return (
    <View style={[{ height, alignSelf: fullWidth ? "stretch" : "flex-start" }, style]}>
      <ReadAnyNativeButtonView
        label={label}
        icon={icon ? icons[icon] : undefined}
        variant={variant}
        color={color}
        foregroundColor={foregroundColor}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel ?? label}
        testID={testID}
        onPress={onPress}
        style={{ width: fullWidth ? "100%" : estimatedWidth, height }}
      />
    </View>
  );
}

export type { NativeButtonProps } from "./NativeButton.types";
