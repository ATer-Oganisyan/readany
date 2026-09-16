import type { SFSymbol } from "sf-symbols-typescript";
import type { MishanaerIconName } from "./MishanaerIcon";

export type NativeContextMenuItem = {
  key: string;
  label: string;
  icon?: MishanaerIconName | null;
  iconPosition?: "leading" | "trailing";
  sfSymbol?: SFSymbol;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export type NativeContextMenuButtonProps = {
  accessibilityLabel: string;
  items: NativeContextMenuItem[];
  sfSymbol?: SFSymbol;
  size?: number;
  color?: string;
  containerColor?: string;
  /**
   * Меню открылось/закрылось. Нужно там, где родитель может размонтировать
   * кнопку по своему таймеру: пока меню открыто, размонтировать его нельзя —
   * вместе с кнопкой исчезнет и само меню.
   */
  onOpenChange?: (open: boolean) => void;
};
