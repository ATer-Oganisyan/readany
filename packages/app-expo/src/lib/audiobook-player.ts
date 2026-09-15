import { useTTSStore } from "@/stores/tts-store";

// Set false in the build environment to keep the previous reader controls.
export const AUDIOBOOK_PLAYER_ENABLED =
  process.env.EXPO_PUBLIC_AUDIOBOOK_PLAYER_ENABLED !== "false";

export async function openAudiobookPlayerFromReader(
  bookId: string,
  startPagePlayback: () => void | Promise<void>,
  openSheet: () => void,
  toggleLegacyPlayback: () => void | Promise<void>,
) {
  if (!AUDIOBOOK_PLAYER_ENABLED) {
    await toggleLegacyPlayback();
    return;
  }
  await startPagePlayback();
  const started = useTTSStore.getState();
  if (started.currentBookId === bookId && started.playState !== "stopped") openSheet();
}
