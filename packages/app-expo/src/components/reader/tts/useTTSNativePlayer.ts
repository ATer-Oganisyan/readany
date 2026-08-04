import { seekActiveTTS, seekActiveTTSBy } from "@/lib/platform/tts-track-controls";
import type { TTSPlayState } from "@readany/core/tts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProgress } from "react-native-track-player";
import type { TTSNativePlayerProps } from "./TTSNativePlayer.types";

function clamp(value: number, max: number) {
  return Math.max(0, Math.min(value, Math.max(0, max)));
}

export function formatTTSPlaybackTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

type ChapterProgressOptions = Pick<
  TTSNativePlayerProps,
  "chapterCurrentIndex" | "chapterTotalChunks" | "onSeekChapterChunk"
>;

function getChapterTimeline(options: ChapterProgressOptions) {
  const total = Math.max(0, Math.floor(options.chapterTotalChunks ?? 0));
  const enabled = total > 0 && typeof options.onSeekChapterChunk === "function";
  const currentIndex = enabled
    ? Math.max(0, Math.min(Math.floor(options.chapterCurrentIndex ?? 0), total - 1))
    : 0;
  return { currentIndex, enabled, total };
}

export function resolveChapterSeekTarget(position: number, totalChunks: number) {
  const total = Math.max(0, Math.floor(totalChunks));
  if (total === 0) return 0;
  const safePosition = Number.isFinite(position) ? position : 0;
  return Math.max(0, Math.min(Math.floor(safePosition), total - 1));
}

export function useTTSNativePlayer(
  playState: TTSPlayState,
  onPlayPause: () => void | Promise<void>,
  chapterProgress: ChapterProgressOptions = {},
) {
  const progress = useProgress(100);
  const chapterTimeline = getChapterTimeline(chapterProgress);
  const [isEditing, setIsEditing] = useState(false);
  const [localPosition, setLocalPosition] = useState(0);
  const localPositionRef = useRef(0);
  const activeTrackDuration = Number.isFinite(progress.duration)
    ? Math.max(0, progress.duration)
    : 0;
  const activeTrackPosition = clamp(progress.position, activeTrackDuration);
  const activeTrackFraction =
    activeTrackDuration > 0 ? activeTrackPosition / activeTrackDuration : 0;
  const duration = chapterTimeline.enabled ? chapterTimeline.total : activeTrackDuration;
  const livePosition = chapterTimeline.enabled
    ? chapterTimeline.currentIndex + activeTrackFraction
    : activeTrackPosition;

  useEffect(() => {
    if (isEditing) return;
    const nextPosition = clamp(livePosition, duration);
    localPositionRef.current = nextPosition;
    setLocalPosition(nextPosition);
  }, [duration, isEditing, livePosition]);

  const setPosition = useCallback(
    (position: number) => {
      const nextPosition = clamp(position, duration);
      localPositionRef.current = nextPosition;
      setLocalPosition(nextPosition);
    },
    [duration],
  );

  const beginSeeking = useCallback(() => setIsEditing(true), []);
  const commitSeeking = useCallback(() => {
    setIsEditing(false);
    if (chapterTimeline.enabled) {
      const targetIndex = resolveChapterSeekTarget(localPositionRef.current, chapterTimeline.total);
      if (targetIndex === chapterTimeline.currentIndex && activeTrackDuration > 0) {
        const fraction = Math.max(0, Math.min(localPositionRef.current - targetIndex, 1));
        void seekActiveTTS(fraction * activeTrackDuration);
        return;
      }
      void chapterProgress.onSeekChapterChunk?.(targetIndex);
      return;
    }
    void seekActiveTTS(localPositionRef.current);
  }, [activeTrackDuration, chapterProgress, chapterTimeline]);
  const seekBackward = useCallback(() => void seekActiveTTSBy(-15), []);
  const seekForward = useCallback(() => void seekActiveTTSBy(15), []);
  const togglePlayback = useCallback(() => void onPlayPause(), [onPlayPause]);

  const progressLabel = chapterTimeline.enabled
    ? `${Math.round((localPosition / chapterTimeline.total) * 100)}%`
    : formatTTSPlaybackTime(localPosition);
  const durationLabel = chapterTimeline.enabled ? "100%" : formatTTSPlaybackTime(duration);
  const progressPercent =
    duration > 0 ? Math.max(0, Math.min(100, Math.round((localPosition / duration) * 100))) : 0;

  return {
    duration,
    durationLabel,
    hasDuration: duration > 0,
    isLoading: playState === "loading",
    isPlaying: playState === "playing",
    localPosition,
    progressPercent,
    progressLabel,
    setPosition,
    beginSeeking,
    commitSeeking,
    seekBackward,
    seekForward,
    togglePlayback,
  };
}
