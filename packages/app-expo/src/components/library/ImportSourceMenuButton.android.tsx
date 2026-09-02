import { useTheme } from "@/styles/theme";
import { typographyStyles } from "@deslop/primitives";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { Button, DropdownMenu, DropdownMenuItem, Host, Text } from "@expo/ui/jetpack-compose";
import { height, offset } from "@expo/ui/jetpack-compose/modifiers";
import { useState } from "react";
import type { ImportSourceMenuButtonProps } from "./ImportSourceMenuButton.types";

const bodyTypography = typographyStyles.find((style) => style.name === "Body");
const bodyFontSize = Number.parseFloat(String(bodyTypography?.fontSize));
const bodyLineHeight = Number.parseFloat(String(bodyTypography?.lineHeight));

export function ImportSourceMenuButton({
  label,
  urlLabel,
  localLabel,
  disabled = false,
  onUrlPress,
  onLocalPress,
}: ImportSourceMenuButtonProps) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const handleSelect = (action: () => void) => {
    setExpanded(false);
    action();
  };

  return (
    <Host matchContents>
      <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
        <Button
          enabled={!disabled}
          onClick={() => setExpanded(true)}
          modifiers={[height(56)]}
          colors={{
            containerColor: colors.primary,
            contentColor: colors.primaryForeground,
          }}
        >
          <Text maxLines={1} style={bodyTextStyle} modifiers={[offset(0, -1)]}>
            {label}
          </Text>
        </Button>
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

const bodyTextStyle = {
  fontFamily: interfaceFontFamily.regular,
  fontSize: bodyFontSize,
  lineHeight: bodyLineHeight,
} as const;
