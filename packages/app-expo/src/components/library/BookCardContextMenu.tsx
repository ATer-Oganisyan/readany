import { Alert, type AlertButton, Pressable, StyleSheet } from "react-native";
import type { BookCardContextMenuProps } from "./BookCardContextMenu.types";

export function BookCardContextMenu({
  accessibilityLabel,
  items,
  onPress,
}: BookCardContextMenuProps) {
  const openMenu = () => {
    const buttons: AlertButton[] = [
      ...items.map(
        (item): AlertButton => ({
          text: item.label,
          style: item.destructive ? "destructive" : "default",
          onPress: item.onPress,
        }),
      ),
      { text: "Отмена", style: "cancel" },
    ];
    Alert.alert(accessibilityLabel, undefined, buttons);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Удерживайте, чтобы открыть меню"
      style={StyleSheet.absoluteFill}
      onPress={onPress}
      onLongPress={openMenu}
    />
  );
}

export type { BookCardContextMenuProps } from "./BookCardContextMenu.types";
