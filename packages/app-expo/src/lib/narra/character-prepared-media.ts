import type { NarraCharacter } from "./types";

function normalizedUri(uri: string | undefined): string | null {
  const value = uri?.trim();
  return value || null;
}

/** Returns the v3 audio only for the greeting it was generated from. */
export function resolvePreparedGreetingAudioUri(
  character: NarraCharacter,
  message: string,
): string | null {
  const greeting = character.greeting?.trim();
  if (!greeting || message.trim() !== greeting) return null;
  return normalizedUri(character.greetingAudioUri);
}

/** Returns the downloaded v3 idle animation used by the character profile. */
export function resolvePreparedIdleAnimationUri(character: NarraCharacter): string | null {
  return normalizedUri(character.idleAnimationUri);
}
