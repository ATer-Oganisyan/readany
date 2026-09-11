export interface ReaderToolbarProps {
  tintColor: string;
  isDark: boolean;
  speechState: "idle" | "loading" | "playing";
  charactersSheetSourceId?: string;
  speechSheetSourceId?: string;
  onSpeechPress: () => void;
  onCharactersPress: () => void;
}
