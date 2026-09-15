import { useTheme } from "@/styles/theme";
import { typographyStyles } from "@deslop/primitives";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { Button, Host, Text } from "@expo/ui/jetpack-compose";
import { height, offset } from "@expo/ui/jetpack-compose/modifiers";
import type { EmptyStateActionButtonProps } from "./empty-state-action-button";
import { EMPTY_STATE_ACTION_HEIGHT } from "./empty-state-action-metrics";

const bodyTypography = typographyStyles.find((style) => style.name === "Body");
export const emptyStateActionTextStyle = {
  fontFamily: interfaceFontFamily.regular,
  fontSize: Number.parseFloat(String(bodyTypography?.fontSize)),
  lineHeight: Number.parseFloat(String(bodyTypography?.lineHeight)),
} as const;

/** Compose control shared by direct actions and the library import menu. */
export function EmptyStateActionControl({ label, disabled = false, onPress }: EmptyStateActionButtonProps) {
  const { colors } = useTheme();
  return (
    <Button
      enabled={!disabled}
      onClick={onPress}
      modifiers={[height(EMPTY_STATE_ACTION_HEIGHT)]}
      colors={{ containerColor: colors.primary, contentColor: colors.primaryForeground }}
    >
      <Text maxLines={1} style={emptyStateActionTextStyle} modifiers={[offset(0, -1)]}>
        {label}
      </Text>
    </Button>
  );
}

export function EmptyStateActionButton(props: EmptyStateActionButtonProps) {
  return <Host matchContents><EmptyStateActionControl {...props} /></Host>;
}
