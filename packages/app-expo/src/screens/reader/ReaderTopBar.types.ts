import type { NativeContextMenuItem } from "@/components/ui/NativeContextMenuButton.types";

export interface ReaderTopBarProps {
  tintColor: string;
  isDark: boolean;
  actions: NativeContextMenuItem[];
  onClosePress: () => void;
  onAppearancePress: () => void;
  onActionsOpenChange?: (open: boolean) => void;
}
