interface CharacterScopeState {
  books: Record<
    string,
    | {
        characters: ReadonlyArray<{ id: string }>;
        backendBinding?: { bookEditionId: string; contentSha256: string };
      }
    | undefined
  >;
}

export interface CharacterRequestScopeOptions {
  bookId: string;
  characterId: string;
  readState: () => CharacterScopeState;
  subscribe: (listener: () => void) => () => void;
}

/** One request lifetime, not a cache key: an observed A→B→A cannot revive it. */
export function createCharacterRequestScope({
  bookId,
  characterId,
  readState,
  subscribe,
}: CharacterRequestScopeOptions) {
  const controller = new AbortController();
  let unsubscribe: (() => void) | undefined;
  const identity = () => {
    const book = readState().books[bookId];
    if (!book?.characters.some((character) => character.id === characterId)) return undefined;
    const binding = book.backendBinding;
    return JSON.stringify(
      binding ? [binding.bookEditionId, binding.contentSha256.toLowerCase()] : [null, null],
    );
  };
  const captured = identity();
  const invalidate = () => {
    const cleanup = unsubscribe;
    unsubscribe = undefined;
    cleanup?.();
    controller.abort();
  };
  const isCurrent = () => {
    if (controller.signal.aborted) return false;
    if (captured === undefined || identity() !== captured) invalidate();
    return !controller.signal.aborted;
  };
  if (isCurrent()) {
    unsubscribe = subscribe(() => {
      isCurrent();
    });
    // Also cover a synchronous transition while a subscription is installed.
    if (!isCurrent()) {
      unsubscribe?.();
      unsubscribe = undefined;
    }
  }
  return { signal: controller.signal, isCurrent, dispose: invalidate };
}
