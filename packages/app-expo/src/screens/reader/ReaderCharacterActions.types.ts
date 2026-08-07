export interface ReaderCharacterActionsProps {
  talkLabel: string;
  listenLabel: string;
  stopLabel: string;
  onTalk: () => void;
  onToggleVoice: () => void;
  canSample: boolean;
  voiceState: "idle" | "loading" | "playing";
  isDark: boolean;
  foregroundColor: string;
}
