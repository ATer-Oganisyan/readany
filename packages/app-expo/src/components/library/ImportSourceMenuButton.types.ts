export interface ImportSourceMenuButtonProps {
  label: string;
  localLabel: string;
  disabled?: boolean;
  onLocalPress: () => void;
  onFallbackPress: () => void;
}
