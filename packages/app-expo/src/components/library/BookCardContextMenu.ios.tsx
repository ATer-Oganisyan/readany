import { Button, ContextMenu, Host, RNHostView } from "@expo/ui/swift-ui";
import type { BookCardContextMenuProps } from "./BookCardContextMenu.types";

export function BookCardContextMenu({
  accessibilityLabel,
  children,
  items,
}: BookCardContextMenuProps) {
  return (
    <Host matchContents ignoreSafeArea="all">
      <ContextMenu testID={accessibilityLabel}>
        <ContextMenu.Trigger>
          <RNHostView matchContents>{children}</RNHostView>
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
