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
  // Opening the player is navigation, not a transport control: a live session
  // keeps playing instead of being re-synthesized from the visible page.
  const hasLiveSession = () => {
    const s = useTTSStore.getState();
    return s.currentBookId === bookId && s.playState !== "stopped";
  };
  if (!hasLiveSession()) await startPagePlayback();
  if (hasLiveSession()) openSheet();
}
