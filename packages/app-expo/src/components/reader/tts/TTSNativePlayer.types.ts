import type { TTSPlayState } from "@readany/core/tts";

export interface TTSNativePlayerProps {
  playState: TTSPlayState;
  onPlayPause: () => void | Promise<void>;
  /** Absolute zero-based segment index inside the current chapter. */
  chapterCurrentIndex?: number;
  /** Total number of narration segments in the current chapter. */
  chapterTotalChunks?: number;
  /** Restarts playback from the selected chapter segment. */
  onSeekChapterChunk?: (index: number) => void | Promise<void>;
}
