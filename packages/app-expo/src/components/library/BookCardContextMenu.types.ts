import type { NativeContextMenuItem } from "@/components/ui/NativeContextMenuButton.types";

export type BookCardContextMenuProps = {
  accessibilityLabel: string;
  items: NativeContextMenuItem[];
  onPress: () => void;
};
