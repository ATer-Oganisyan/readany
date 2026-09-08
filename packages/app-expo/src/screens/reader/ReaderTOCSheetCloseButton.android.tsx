import { getStrokeIconImageSource } from "@/components/ui/MishanaerIcon";
import { Host, Icon, IconButton } from "@expo/ui/jetpack-compose";
import type { ReaderTOCSheetCloseButtonProps } from "./ReaderTOCSheetCloseButton.types";

export function ReaderTOCSheetCloseButton({
  colorScheme,
  foregroundColor,
  onPress,
}: ReaderTOCSheetCloseButtonProps) {
  return (
    <Host colorScheme={colorScheme} style={{ width: 48, height: 48 }}>
      <IconButton onClick={onPress} colors={{ contentColor: foregroundColor }}>
        <Icon
          source={getStrokeIconImageSource("x")}
          size={24}
          tint={foregroundColor}
          contentDescription="Close"
        />
      </IconButton>
    </Host>
  );
}

export type { ReaderTOCSheetCloseButtonProps } from "./ReaderTOCSheetCloseButton.types";
