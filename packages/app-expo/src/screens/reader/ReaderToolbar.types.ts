export interface ReaderToolbarProps {
  tintColor: string;
  isDark: boolean;
  speechState: "idle" | "loading" | "playing";
  onSpeechPress: () => void;
  onChatPress: () => void;
}
