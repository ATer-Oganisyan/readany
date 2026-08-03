import { Button, Host, Menu } from "@expo/ui/swift-ui";
import { buttonStyle, disabled, frame, labelStyle, tint } from "@expo/ui/swift-ui/modifiers";
import type { NativeContextMenuButtonProps } from "./NativeContextMenuButton.types";

export function NativeContextMenuButton({
  accessibilityLabel,
  items,
  sfSymbol = "ellipsis",
  size = 40,
  color,
}: NativeContextMenuButtonProps) {
  return (
    <Host style={{ width: size, height: size }}>
      <Menu
        label={accessibilityLabel}
        systemImage={sfSymbol as never}
        modifiers={[
          buttonStyle("plain"),
          labelStyle("iconOnly"),
          frame({ width: size, height: size }),
          ...(color ? [tint(color)] : []),
        ]}
        testID={accessibilityLabel}
      >
        {items.map((item) => (
          <Button
            key={item.key}
            label={item.label}
            systemImage={item.sfSymbol as never}
            role={item.destructive ? "destructive" : "default"}
            onPress={item.onPress}
            modifiers={item.disabled ? [disabled(true)] : undefined}
          />
        ))}
      </Menu>
    </Host>
  );
}
