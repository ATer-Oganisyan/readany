import { BookOpenIcon, MoreVerticalIcon, ShareIcon } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import { Alert, type AlertButton, TouchableOpacity } from "react-native";
import type { NativeContextMenuButtonProps } from "./NativeContextMenuButton.types";

export function NativeContextMenuButton({
  accessibilityLabel,
  items,
  sfSymbol = "ellipsis",
  size = 40,
  color,
}: NativeContextMenuButtonProps) {
  const colors = useColors();
  const iconColor = color ?? colors.foreground;

  const openMenu = () => {
    const availableItems = items.filter((item) => !item.disabled);
    const buttons: AlertButton[] = availableItems
      .map(
        (item): AlertButton => ({
          text: item.label,
          style: item.destructive ? "destructive" : "default",
          onPress: item.onPress,
        }),
      )
      .concat([{ text: "Отмена", style: "cancel" }]);
    Alert.alert(accessibilityLabel, undefined, buttons);
  };

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
      activeOpacity={0.7}
      onPress={openMenu}
    >
      {sfSymbol.startsWith("book") ? (
        <BookOpenIcon size={18} color={iconColor} />
      ) : sfSymbol === "square.and.arrow.up" ? (
        <ShareIcon size={18} color={iconColor} />
      ) : (
        <MoreVerticalIcon size={18} color={iconColor} />
      )}
    </TouchableOpacity>
  );
}
