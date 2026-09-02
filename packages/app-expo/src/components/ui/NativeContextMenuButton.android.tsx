import { getStrokeIconImageSource, resolveSystemIconName } from "@/components/ui/MishanaerIcon";
import { useColors } from "@/styles/theme";
import { typographyStyles } from "@deslop/primitives";
import { interfaceFontFamily } from "@deslop/primitives/native";
import {
  DropdownMenu,
  DropdownMenuItem,
  Host,
  Icon,
  IconButton,
  Text,
} from "@expo/ui/jetpack-compose";
import { size as frameSize } from "@expo/ui/jetpack-compose/modifiers";
import { useCallback, useState } from "react";
import type { NativeContextMenuButtonProps } from "./NativeContextMenuButton.types";

const bodyTypography = typographyStyles.find((style) => style.name === "Body");
const bodyTextStyle = {
  fontFamily: interfaceFontFamily.regular,
  fontSize: Number.parseFloat(String(bodyTypography?.fontSize)),
  lineHeight: Number.parseFloat(String(bodyTypography?.lineHeight)),
} as const;

export function NativeContextMenuButton({
  accessibilityLabel,
  items,
  sfSymbol = "ellipsis",
  size = 40,
  color,
  onOpenChange,
}: NativeContextMenuButtonProps) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const iconColor = color ?? colors.foreground;

  const setOpen = useCallback(
    (next: boolean) => {
      setExpanded(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const handleSelect = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <Host matchContents>
      <DropdownMenu expanded={expanded} color={colors.card} onDismissRequest={() => setOpen(false)}>
        <IconButton
          onClick={() => setOpen(true)}
          modifiers={[frameSize(size, size)]}
          colors={{ contentColor: iconColor }}
        >
          <Icon
            source={getStrokeIconImageSource(resolveSystemIconName(sfSymbol))}
            size={20}
            tint={iconColor}
            contentDescription={accessibilityLabel}
          />
        </IconButton>

        <DropdownMenu.Items>
          {items.map((item) => {
            const itemColor = item.destructive ? colors.destructive : colors.foreground;
            const itemIcon = item.icon ?? resolveSystemIconName(item.sfSymbol ?? "info.circle");

            return (
              <DropdownMenuItem
                key={item.key}
                enabled={!item.disabled}
                elementColors={{
                  textColor: itemColor,
                  leadingIconColor: itemColor,
                  disabledTextColor: colors.mutedForeground,
                  disabledLeadingIconColor: colors.mutedForeground,
                }}
                onClick={() => handleSelect(item.onPress)}
              >
                <DropdownMenuItem.Text>
                  <Text maxLines={1} style={bodyTextStyle}>
                    {item.label}
                  </Text>
                </DropdownMenuItem.Text>
                <DropdownMenuItem.LeadingIcon>
                  <Icon source={getStrokeIconImageSource(itemIcon)} size={20} tint={itemColor} />
                </DropdownMenuItem.LeadingIcon>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}
