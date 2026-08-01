import { NativeButton } from "./NativeButton";

export interface EmptyStateActionButtonProps {
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress: () => void;
}

/** Non-iOS fallback matches the library's import action fallback. */
export function EmptyStateActionButton({
  label,
  accessibilityLabel,
  disabled = false,
  onPress,
}: EmptyStateActionButtonProps) {
  return (
    <NativeButton
      label={label}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      icon="add"
      size="large"
      onPress={onPress}
    />
  );
}
