export interface ImportSourceHeaderMenuButtonProps {
  accessibilityLabel: string;
  urlLabel: string;
  localLabel: string;
  color: string;
  disabled?: boolean;
  onUrlPress: () => void;
  onLocalPress: () => void;
  onFallbackPress: () => void;
}
