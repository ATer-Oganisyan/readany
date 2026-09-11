import { useTTSStore } from "@/stores/tts-store";

// Set false in the build environment to keep the previous reader controls.
export const AUDIOBOOK_PLAYER_ENABLED =
  process.env.EXPO_PUBLIC_AUDIOBOOK_PLAYER_ENABLED !== "false";

export async function openAudiobookPlayerFromReader(
  bookId: string,
  togglePlayback: () => void | Promise<void>,
  openSheet: () => void,
) {
  if (!AUDIOBOOK_PLAYER_ENABLED) {
    await togglePlayback();
    return;
  }
  const current = useTTSStore.getState();
  if (current.currentBookId !== bookId || current.playState === "stopped") {
    await togglePlayback();
  }
  const started = useTTSStore.getState();
  if (started.currentBookId === bookId && started.playState !== "stopped") openSheet();
}
