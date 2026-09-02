import { PlusIcon } from "@/components/ui/Icon";
import { TouchableOpacity } from "react-native";
import type { ImportSourceHeaderMenuButtonProps } from "./ImportSourceHeaderMenuButton.types";

export function ImportSourceHeaderMenuButton({
  accessibilityLabel,
  color,
  disabled = false,
  onFallbackPress,
}: ImportSourceHeaderMenuButtonProps) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
      onPress={onFallbackPress}
      disabled={disabled}
      activeOpacity={0.65}
    >
      <PlusIcon size={24} color={color} />
    </TouchableOpacity>
  );
}
