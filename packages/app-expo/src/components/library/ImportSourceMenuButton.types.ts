export interface ImportSourceMenuButtonProps {
  label: string;
  urlLabel: string;
  localLabel: string;
  disabled?: boolean;
  onUrlPress: () => void;
  onLocalPress: () => void;
  onFallbackPress: () => void;
}
