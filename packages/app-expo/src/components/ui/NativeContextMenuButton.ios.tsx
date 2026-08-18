import { useColors } from "@/styles/theme";
import { Button, Host, Label, Menu } from "@expo/ui/swift-ui";
import { buttonStyle, disabled, frame, labelStyle, tint } from "@expo/ui/swift-ui/modifiers";
import { HostedMishanaerIcon } from "./HostedMishanaerIcon";
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

  return (
    <Host style={{ width: size, height: size }}>
      <Menu
        label={<HostedMishanaerIcon systemName={sfSymbol} size={20} color={iconColor} />}
        modifiers={[
          buttonStyle("plain"),
          labelStyle("iconOnly"),
          frame({ width: size, height: size }),
          tint(iconColor),
        ]}
        testID={accessibilityLabel}
      >
        {items.map((item) => (
          <Button
            key={item.key}
            role={item.destructive ? "destructive" : "default"}
            onPress={item.onPress}
            modifiers={item.disabled ? [disabled(true)] : undefined}
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
      </Menu>
    </Host>
  );
}
