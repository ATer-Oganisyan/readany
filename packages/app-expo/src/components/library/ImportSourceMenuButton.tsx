import { NativeButton } from "@/components/ui/NativeButton";
import type { ImportSourceMenuButtonProps } from "./ImportSourceMenuButton.types";

export function ImportSourceMenuButton({
  label,
  disabled = false,
  onFallbackPress,
}: ImportSourceMenuButtonProps) {
  return <NativeButton label={label} onPress={onFallbackPress} disabled={disabled} size="large" />;
}
