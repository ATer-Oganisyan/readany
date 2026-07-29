import { Button, ContextMenu, Host, Rectangle } from "@expo/ui/swift-ui";
import { foregroundStyle, frame, onTapGesture } from "@expo/ui/swift-ui/modifiers";
import { StyleSheet } from "react-native";
import type { BookCardContextMenuProps } from "./BookCardContextMenu.types";

export function BookCardContextMenu({
  accessibilityLabel,
  items,
  onPress,
}: BookCardContextMenuProps) {
  return (
    <Host style={StyleSheet.absoluteFill}>
      <ContextMenu testID={accessibilityLabel}>
        <ContextMenu.Trigger>
          <Rectangle
            modifiers={[
              frame({ maxWidth: 10_000, maxHeight: 10_000 }),
              foregroundStyle("#00000001"),
              onTapGesture(onPress),
            ]}
          />
        </ContextMenu.Trigger>
        <ContextMenu.Items>
          {items.map((item) => (
            <Button
              key={item.key}
              label={item.label}
              systemImage={item.sfSymbol as never}
              role={item.destructive ? "destructive" : "default"}
              onPress={item.onPress}
            />
          ))}
        </ContextMenu.Items>
      </ContextMenu>
    </Host>
  );
}

export type { BookCardContextMenuProps } from "./BookCardContextMenu.types";
