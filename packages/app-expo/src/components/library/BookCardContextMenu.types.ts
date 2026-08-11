import type { NativeContextMenuItem } from "@/components/ui/NativeContextMenuButton.types";
import type { ReactElement } from "react";

export type BookCardContextMenuProps = {
  accessibilityLabel: string;
  children: ReactElement;
  items: NativeContextMenuItem[];
  onPress: () => void;
};
