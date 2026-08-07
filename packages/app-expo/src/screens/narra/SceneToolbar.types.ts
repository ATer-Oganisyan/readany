export interface SceneToolbarProps {
  tintColor: string;
  isDark: boolean;
  speechActive: boolean;
  speechDisabled: boolean;
  regenerateDisabled: boolean;
  onSpeechPress: () => void;
  onRegeneratePress: () => void;
}
