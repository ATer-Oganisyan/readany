import { HostedMishanaerIcon } from "@/components/ui/HostedMishanaerIcon";
import { useColors } from "@/styles/theme";
import { Button, ContextMenu, Host, Label, RNHostView } from "@expo/ui/swift-ui";
import type { BookCardContextMenuProps } from "./BookCardContextMenu.types";

export function BookCardContextMenu({
  accessibilityLabel,
  children,
  items,
}: BookCardContextMenuProps) {
  const colors = useColors();

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
              role={item.destructive ? "destructive" : "default"}
              onPress={item.onPress}
            >
              <Label
                title={item.label}
                icon={
                  item.sfSymbol ? (
                    <HostedMishanaerIcon
                      systemName={item.sfSymbol}
                      size={18}
                      color={item.destructive ? colors.destructive : colors.foreground}
                    />
                  ) : undefined
                }
              />
            </Button>
          ))}
        </ContextMenu.Items>
      </ContextMenu>
    </Host>
  );
}

export type { BookCardContextMenuProps } from "./BookCardContextMenu.types";
