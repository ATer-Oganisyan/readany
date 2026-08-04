import TrackPlayer from "react-native-track-player";
import { chunkIndexFromTrackId } from "./track-player-chunk-id";

function clampPosition(position: number, duration: number): number {
  if (!Number.isFinite(position)) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, position);
  return Math.max(0, Math.min(position, duration));
}

export async function seekActiveTTS(position: number): Promise<void> {
  const progress = await TrackPlayer.getProgress().catch(() => null);
  if (!progress) return;
  await TrackPlayer.seekTo(clampPosition(position, progress.duration)).catch(() => {});
}

export async function seekActiveTTSBy(deltaSeconds: number): Promise<void> {
  const progress = await TrackPlayer.getProgress().catch(() => null);
  if (!progress) return;
  const targetPosition = progress.position + deltaSeconds;
  if (targetPosition >= 0 && targetPosition <= progress.duration) {
    await TrackPlayer.seekTo(targetPosition).catch(() => {});
    return;
  }

  const [queue, activeIndex] = await Promise.all([
    TrackPlayer.getQueue().catch(() => []),
    TrackPlayer.getActiveTrackIndex().catch(() => undefined),
  ]);
  if (activeIndex == null) return;

  if (deltaSeconds > 0) {
    const nextIndex = queue.findIndex(
      (track, index) => index > activeIndex && chunkIndexFromTrackId(track.id) != null,
    );
    if (nextIndex >= 0) {
      const overflow = Math.max(0, targetPosition - progress.duration);
      await TrackPlayer.skip(nextIndex, overflow).catch(() => {});
      return;
    }
    await TrackPlayer.seekTo(progress.duration).catch(() => {});
    return;
  }

  let previousIndex = -1;
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    if (chunkIndexFromTrackId(queue[index]?.id) != null) {
      previousIndex = index;
      break;
    }
  }
  if (previousIndex < 0) {
    await TrackPlayer.seekTo(0).catch(() => {});
    return;
  }

  const overflow = Math.max(0, -targetPosition);
  await TrackPlayer.skip(previousIndex).catch(() => {});
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const previousProgress = await TrackPlayer.getProgress().catch(() => null);
    if (previousProgress && previousProgress.duration > 0) {
      await TrackPlayer.seekTo(Math.max(0, previousProgress.duration - overflow)).catch(() => {});
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}
