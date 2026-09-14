import type { RefObject } from "react";
import type { View } from "react-native";

export interface ReaderCharacterActionsProps {
  blurTarget?: RefObject<View | null>;
  talkLabel: string;
  listenLabel: string;
  stopLabel: string;
  regenerateLabel: string;
  onTalk: () => void;
  onToggleVoice: () => void;
  onRegenerate: () => void;
  canSample: boolean;
  regenerating: boolean;
  showRegenerate: boolean;
  voiceState: "idle" | "loading" | "playing";
  isDark: boolean;
  foregroundColor: string;
  primaryForegroundColor: string;
}
