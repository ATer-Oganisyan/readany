export interface ImportSourceHeaderMenuButtonProps {
  accessibilityLabel: string;
  localLabel: string;
  color: string;
  disabled?: boolean;
  onLocalPress: () => void;
  onFallbackPress: () => void;
}
