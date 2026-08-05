import { useColors } from "@/styles/theme";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import {
  Box,
  DropdownMenu,
  DropdownMenuItem,
  Host,
  Text,
} from "@expo/ui/jetpack-compose";
import { useState } from "react";
import { TouchableOpacity, View } from "react-native";
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
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={{ width: size, height: size }}>
      <Host style={{ position: "absolute", right: 0, top: size / 2, width: 1, height: 1 }}>
        <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
          <Box />

          <DropdownMenu.Items>
            {items.map((item) => (
              <DropdownMenuItem
                key={item.key}
                enabled={!item.disabled}
                elementColors={item.destructive ? { textColor: colors.destructive } : undefined}
                onClick={() => {
                  setExpanded(false);
                  item.onPress();
                }}
              >
                <DropdownMenuItem.Text>
                  <Text>{item.label}</Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
            ))}
          </DropdownMenu.Items>
        </DropdownMenu>
      </Host>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
        activeOpacity={0.7}
        onPress={() => setExpanded(true)}
      >
        <MaterialIcons
          name={
            sfSymbol.startsWith("book")
              ? "menu-book"
              : sfSymbol === "square.and.arrow.up"
                ? "share"
                : "more-vert"
          }
          size={22}
          color={iconColor}
        />
      </TouchableOpacity>
    </View>
  );
}
