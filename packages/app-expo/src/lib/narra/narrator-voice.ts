import { useNarraStore } from "@/stores/narra-store";
import { useTTSStore } from "@/stores/tts-store";
import { isActivePlay } from "@readany/core/tts";
import { replaceReaderNarratorVoice } from "./voice-markup";
import {
  DEFAULT_NARRATOR_PREFERENCE,
  type NarraNarratorPreference,
  narratorVoiceFor,
} from "./voice-rules";

/** Saves the narrator voice and, if a book is playing, re-reads the current sentence with it. */
export function changeNarratorVoice(preference: NarraNarratorPreference): void {
  const narra = useNarraStore.getState();
  const previousVoice = narratorVoiceFor(narra.narratorVoicePreference);
  const nextVoice = narratorVoiceFor(preference);
  narra.setNarratorVoicePreference(preference);
  if (previousVoice === nextVoice) return;

  replaceReaderNarratorVoice(previousVoice, nextVoice);
  const { playState, currentChunkIndex, jumpToChunk } = useTTSStore.getState();
  if (isActivePlay(playState)) jumpToChunk(currentChunkIndex);
}

/** The saved choice, or the default voice when the user has not picked one yet. */
export function useNarratorVoicePreference(): NarraNarratorPreference {
  return useNarraStore((s) => s.narratorVoicePreference) ?? DEFAULT_NARRATOR_PREFERENCE;
}
