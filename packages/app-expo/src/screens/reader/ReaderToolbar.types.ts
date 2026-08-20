export interface ReaderToolbarProps {
  tintColor: string;
  isDark: boolean;
  speechState: "idle" | "loading" | "playing";
  chatMorphSourceId?: string;
  onSpeechPress: () => void;
  onChatPress: () => void;
}
