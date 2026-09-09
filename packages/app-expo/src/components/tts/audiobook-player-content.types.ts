import type { useTTSNativePlayer } from "@/components/reader/tts/useTTSNativePlayer";

export const AUDIOBOOK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const AUDIOBOOK_TIMER_MINUTES = [15, 30, 45, 60] as const;

export interface AudiobookPlayerContentProps {
  title: string;
  author: string;
  chapter: string;
  volume: number;
  rate: number;
  timerActive: boolean;
  player: ReturnType<typeof useTTSNativePlayer>;
  onPreviousSentence: () => void;
  onNextSentence: () => void;
  canGoToPreviousSentence: boolean;
  canGoToNextSentence: boolean;
  onStop: () => void;
  onRead: () => void;
  onRateChange: (rate: number) => void;
  onSetTimer: (minutes: number) => void;
  onClearTimer: () => void;
  onCustomTimer: () => void;
  onVolumeChange: (volume: number) => void;
}
