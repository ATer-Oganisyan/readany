export interface ReaderFloatingActionsProps {
  translationActive: boolean;
  speechActive: boolean;
  accentColor: string;
  onTranslate: () => void;
  onSpeech: () => void;
  onChat: () => void;
}
