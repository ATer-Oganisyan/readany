import type { NativeContextMenuButtonProps } from "@/components/ui/NativeContextMenuButton.types";
import { useColors } from "@/styles/theme";
import { Box, DropdownMenu, DropdownMenuItem, Host, Text } from "@expo/ui/jetpack-compose";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useState } from "react";
import { TouchableOpacity, View } from "react-native";

/** Android Material/Compose implementation. iOS is selected by the outer `.ios.tsx` adapter. */
export function NativeContextMenuButton({
  accessibilityLabel,
  items,
  sfSymbol = "ellipsis",
  size = 40,
  color,
  onOpenChange,
}: NativeContextMenuButtonProps) {
  const colors = useColors();
  const iconColor = color ?? colors.foreground;
  const [expanded, setExpanded] = useState(false);
  const setMenuExpanded = useCallback(
    (open: boolean) => {
      setExpanded(open);
      onOpenChange?.(open);
    },
    [onOpenChange],
  );

  return (
    <View style={{ width: size, height: size }}>
      <Host style={{ position: "absolute", right: 0, top: size / 2, width: 1, height: 1 }}>
        <DropdownMenu expanded={expanded} onDismissRequest={() => setMenuExpanded(false)}>
          <Box />
          <DropdownMenu.Items>
            {items.map((item) => (
              <DropdownMenuItem
                key={item.key}
                enabled={!item.disabled}
                elementColors={item.destructive ? { textColor: colors.destructive } : undefined}
                onClick={() => {
                  setMenuExpanded(false);
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
        onPress={() => setMenuExpanded(true)}
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
