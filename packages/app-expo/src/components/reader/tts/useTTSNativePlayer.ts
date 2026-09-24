import { seekActiveTTS, seekActiveTTSBy } from "@/lib/platform/tts-track-controls";
import type { MotionDirection } from "@/lib/tts-motion/playback-motion";
import { useTTSStore } from "@/stores/tts-store";
import type { TTSPlayState } from "@readany/core/tts";
import { useCallback, useEffect, useRef, useState } from "react";
import { State, usePlaybackState, useProgress } from "react-native-track-player";
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
  "chapterCurrentIndex" | "chapterTotalChunks" | "onSeekChapterChunk" | "chapterProgressOnly"
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

export function useTTSBuffering(playState: TTSPlayState) {
  const nativePlayback = usePlaybackState();
  const synthesisBuffering = useTTSStore((state) => state.isBuffering);
  const buffering =
    nativePlayback.state === State.Buffering || nativePlayback.state === State.Loading;
  const [confirmedBuffering, setConfirmedBuffering] = useState(false);
  useEffect(() => {
    setConfirmedBuffering(false);
    if (playState !== "playing" || !buffering) return;
    const timer = setTimeout(() => setConfirmedBuffering(true), 500);
    return () => clearTimeout(timer);
  }, [playState, buffering]);
  return {
    buffering: buffering || synthesisBuffering,
    confirmedBuffering: confirmedBuffering || synthesisBuffering,
  };
}

export function useTTSNativePlayer(
  playState: TTSPlayState,
  onPlayPause: () => void | Promise<void>,
  chapterProgress: ChapterProgressOptions = {},
) {
  const progress = useProgress(100);
  const { buffering, confirmedBuffering } = useTTSBuffering(playState);
  const [isSeeking, setIsSeeking] = useState(false);
  // The loader spins the way the listener is moving. Plain buffering keeps the
  // last direction; nothing the user did points backwards by default.
  const [seekDirection, setSeekDirection] = useState<MotionDirection>(1);
  const seekOrigin = useRef(0);
  const seekGeneration = useRef(0);
  useEffect(
    () => () => {
      seekGeneration.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (playState === "paused" || playState === "stopped") {
      seekGeneration.current += 1;
      setIsSeeking(false);
    }
  }, [playState]);
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
  const duration = chapterTimeline.enabled
    ? chapterTimeline.total
    : chapterProgress.chapterProgressOnly
      ? 0
      : activeTrackDuration;
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

  const beginSeeking = useCallback(() => {
    seekOrigin.current = localPositionRef.current;
    setIsEditing(true);
  }, []);
  const commitSeeking = useCallback(() => {
    setIsEditing(false);
    setSeekDirection(localPositionRef.current < seekOrigin.current ? -1 : 1);
    const generation = ++seekGeneration.current;
    setIsSeeking(playState === "playing" || playState === "loading");
    void (async () => {
      try {
        if (chapterTimeline.enabled) {
          const targetIndex = resolveChapterSeekTarget(
            localPositionRef.current,
            chapterTimeline.total,
          );
          if (targetIndex === chapterTimeline.currentIndex && activeTrackDuration > 0) {
            const fraction = Math.max(0, Math.min(localPositionRef.current - targetIndex, 1));
            await seekActiveTTS(fraction * activeTrackDuration);
          } else {
            await chapterProgress.onSeekChapterChunk?.(targetIndex);
          }
        } else if (!chapterProgress.chapterProgressOnly) {
          await seekActiveTTS(localPositionRef.current);
        }
      } finally {
        if (generation === seekGeneration.current) setIsSeeking(false);
      }
    })().catch((error) => console.warn("[TTS] Seek failed:", error));
  }, [activeTrackDuration, chapterProgress, chapterTimeline, playState]);
  const seekBackward = useCallback(() => {
    setSeekDirection(-1);
    void seekActiveTTSBy(-15);
  }, []);
  const seekForward = useCallback(() => {
    setSeekDirection(1);
    void seekActiveTTSBy(15);
  }, []);
  const isLoading =
    playState === "loading" ||
    (playState === "playing" && (isSeeking || (buffering && confirmedBuffering)));
  // Once the loader is gone the backward gesture is over: a later buffering
  // hiccup the listener did not cause must spin the authored way.
  useEffect(() => {
    if (!isLoading) setSeekDirection(1);
  }, [isLoading]);
  const noteSeek: (direction: MotionDirection) => void = setSeekDirection;
  const togglePlayback = useCallback(() => {
    // Pressing play is not a move backwards, even right after seeking back.
    setSeekDirection(1);
    void onPlayPause();
  }, [onPlayPause]);

  const progressLabel = chapterTimeline.enabled
    ? `${Math.round((localPosition / chapterTimeline.total) * 100)}%`
    : chapterProgress.chapterProgressOnly
      ? "—"
      : formatTTSPlaybackTime(localPosition);
  const durationLabel =
    chapterTimeline.enabled || chapterProgress.chapterProgressOnly
      ? "100%"
      : formatTTSPlaybackTime(duration);
  const progressPercent =
    duration > 0 ? Math.max(0, Math.min(100, Math.round((localPosition / duration) * 100))) : 0;

  return {
    duration,
    durationLabel,
    hasDuration: duration > 0,
    isLoading,
    isPlaying: playState === "playing",
    loadingDirection: seekDirection,
    localPosition,
    progressPercent,
    progressLabel,
    setPosition,
    beginSeeking,
    commitSeeking,
    noteSeek,
    seekBackward,
    seekForward,
    togglePlayback,
  };
}
