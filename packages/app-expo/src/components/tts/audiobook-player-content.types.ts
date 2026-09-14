import type { useTTSNativePlayer } from "@/components/reader/tts/useTTSNativePlayer";

export interface AudiobookPlayerContentProps {
  backgroundColor?: string;
  accentColor?: string;
  title: string;
  author: string;
  chapter: string;
  volume: number;
  player: ReturnType<typeof useTTSNativePlayer>;
  onPreviousSentence: () => void;
  onNextSentence: () => void;
  canGoToPreviousSentence: boolean;
  canGoToNextSentence: boolean;
  onStop: () => void;
  onRead: () => void;
  onVolumeChange: (volume: number) => void;
}
