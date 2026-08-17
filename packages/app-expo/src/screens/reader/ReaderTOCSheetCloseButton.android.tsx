import { interfaceFontFamily } from "@deslop/primitives/native";
import { Host, IconButton, Text } from "@expo/ui/jetpack-compose";
import type { ReaderTOCSheetCloseButtonProps } from "./ReaderTOCSheetCloseButton.types";

export function ReaderTOCSheetCloseButton({
  colorScheme,
  foregroundColor,
  onPress,
}: ReaderTOCSheetCloseButtonProps) {
  return (
    <Host colorScheme={colorScheme} style={{ width: 48, height: 48 }}>
      <IconButton onClick={onPress} colors={{ contentColor: foregroundColor }}>
        <Text
          color={foregroundColor}
          style={{ fontFamily: interfaceFontFamily.materialSymbols, fontSize: 24 }}
        >
          close
        </Text>
      </IconButton>
    </Host>
  );
}

export type { ReaderTOCSheetCloseButtonProps } from "./ReaderTOCSheetCloseButton.types";
