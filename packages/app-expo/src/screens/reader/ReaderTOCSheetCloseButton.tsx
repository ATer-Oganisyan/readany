import { XIcon } from "@/components/ui/Icon";
import { Pressable } from "react-native";
import type { ReaderTOCSheetCloseButtonProps } from "./ReaderTOCSheetCloseButton.types";

/** Web fallback. Native Android builds resolve the Jetpack Compose implementation. */
export function ReaderTOCSheetCloseButton({
  accessibilityLabel,
  foregroundColor,
  onPress,
}: ReaderTOCSheetCloseButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
    >
      <XIcon size={20} color={foregroundColor} />
    </Pressable>
  );
}

export type { ReaderTOCSheetCloseButtonProps } from "./ReaderTOCSheetCloseButton.types";
