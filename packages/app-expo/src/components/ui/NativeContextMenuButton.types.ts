export type NativeContextMenuItem = {
  key: string;
  label: string;
  sfSymbol?: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export type NativeContextMenuButtonProps = {
  accessibilityLabel: string;
  items: NativeContextMenuItem[];
  sfSymbol?: string;
  size?: number;
  color?: string;
  onOpenChange?: (open: boolean) => void;
};
