import { EmptyStateActionControl, emptyStateActionTextStyle } from "@/components/ui/empty-state-action-button.android";
import { DropdownMenu, DropdownMenuItem, Host, Text } from "@expo/ui/jetpack-compose";
import { useState } from "react";
import type { ImportSourceMenuButtonProps } from "./ImportSourceMenuButton.types";

export function ImportSourceMenuButton({
  label,
  localLabel,
  disabled = false,
  onLocalPress,
}: ImportSourceMenuButtonProps) {
  const [expanded, setExpanded] = useState(false);

  const handleSelect = (action: () => void) => {
    setExpanded(false);
    action();
  };

  return (
    <Host matchContents>
      <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
        <EmptyStateActionControl
          label={label}
          disabled={disabled}
          onPress={() => setExpanded(true)}
        />
        <DropdownMenu.Items>
          <DropdownMenuItem onClick={() => handleSelect(onLocalPress)}>
            <DropdownMenuItem.Text>
              <Text maxLines={1} style={emptyStateActionTextStyle}>
                {localLabel}
              </Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}
