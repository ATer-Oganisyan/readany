export interface ReaderFloatingActionsProps {
  translationActive: boolean;
  speechActive: boolean;
  accentColor: string;
  foregroundColor: string;
  isDark: boolean;
  onTranslate: () => void;
  onSpeech: () => void;
  onChat: () => void;
}
