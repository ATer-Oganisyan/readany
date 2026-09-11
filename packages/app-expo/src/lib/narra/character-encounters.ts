import { useNarraStore } from "@/stores/narra-store";

export function recordCharacterEncounters(
  bookId: string,
  characterIds: readonly string[],
  loadId: string | undefined,
  activeLoadId: string | null,
): boolean {
  if (!loadId || loadId !== activeLoadId) return false;
  let changed = false;
  for (const id of characterIds) {
    const state = useNarraStore.getState();
    const character = state.books[bookId]?.characters.find((item) => item.id === id);
    if (!character || character.encounteredInReader) continue;
    state.updateCharacter(bookId, id, { encounteredInReader: true });
    changed = true;
  }
  return changed;
}
