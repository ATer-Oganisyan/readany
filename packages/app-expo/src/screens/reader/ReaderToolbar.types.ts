export interface ReaderToolbarProps {
  tintColor: string;
  isDark: boolean;
  speechState: "idle" | "preparing" | "loading" | "playing";
  charactersSheetSourceId?: string;
  onSpeechPress: () => void;
  onCharactersPress: () => void;
}
