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
  /**
   * Меню открылось/закрылось. Нужно там, где родитель может размонтировать
   * кнопку по своему таймеру: пока меню открыто, размонтировать его нельзя —
   * вместе с кнопкой исчезнет и само меню.
   */
  onOpenChange?: (open: boolean) => void;
};
