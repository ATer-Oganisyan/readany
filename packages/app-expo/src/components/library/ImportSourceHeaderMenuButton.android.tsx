import { getStrokeIconImageSource } from "@/components/ui/MishanaerIcon";
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
import { size } from "@expo/ui/jetpack-compose/modifiers";
import { useState } from "react";
import type { ImportSourceHeaderMenuButtonProps } from "./ImportSourceHeaderMenuButton.types";

const bodyTypography = typographyStyles.find((style) => style.name === "Body");
const bodyTextStyle = {
  fontFamily: interfaceFontFamily.regular,
  fontSize: Number.parseFloat(String(bodyTypography?.fontSize)),
  lineHeight: Number.parseFloat(String(bodyTypography?.lineHeight)),
} as const;

export function ImportSourceHeaderMenuButton({
  accessibilityLabel,
  urlLabel,
  localLabel,
  color,
  disabled = false,
  onUrlPress,
  onLocalPress,
}: ImportSourceHeaderMenuButtonProps) {
  const [expanded, setExpanded] = useState(false);

  const handleSelect = (action: () => void) => {
    setExpanded(false);
    action();
  };

  return (
    <Host matchContents>
      <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
        <IconButton
          enabled={!disabled}
          onClick={() => setExpanded(true)}
          modifiers={[size(40, 40)]}
          colors={{ contentColor: color }}
        >
          <Icon
            source={getStrokeIconImageSource("plus")}
            size={24}
            tint={color}
            contentDescription={accessibilityLabel}
          />
        </IconButton>
        <DropdownMenu.Items>
          <DropdownMenuItem onClick={() => handleSelect(onLocalPress)}>
            <DropdownMenuItem.Text>
              <Text maxLines={1} style={bodyTextStyle}>
                {localLabel}
              </Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleSelect(onUrlPress)}>
            <DropdownMenuItem.Text>
              <Text maxLines={1} style={bodyTextStyle}>
                {urlLabel}
              </Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}
