export interface ReaderToolbarProps {
  tintColor: string;
  isDark: boolean;
  speechState: "idle" | "loading" | "playing";
  charactersSheetSourceId?: string;
  onSpeechPress: () => void;
  onCharactersPress: () => void;
}
