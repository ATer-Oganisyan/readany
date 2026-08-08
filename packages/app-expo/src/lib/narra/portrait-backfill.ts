import { isCharacterUnlocked } from "./domain";
import type { NarraBookState, NarraCharacter } from "./types";

const RETRY_DELAYS_MS = [2_000, 8_000] as const;

export interface PortraitBackfillBook {
  id: string;
  progress: number;
}

export interface PortraitBackfillJob {
  bookId: string;
  character: NarraCharacter;
}

export function collectPortraitBackfillJobs(
  books: readonly PortraitBackfillBook[],
  narraBooks: Readonly<Record<string, NarraBookState | undefined>>,
): PortraitBackfillJob[] {
  const jobs: PortraitBackfillJob[] = [];
  for (const book of books) {
    for (const character of narraBooks[book.id]?.characters ?? []) {
      if (
        !character.portraitUri &&
        !character.portraitAssetId &&
        isCharacterUnlocked(book.progress, character)
      ) {
        jobs.push({ bookId: book.id, character });
      }
    }
  }
  return jobs;
}

export async function runPortraitBackfillWithRetry<T>(
  operation: () => Promise<T>,
  wait: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise((resolve) => setTimeout(resolve, delayMs)),
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryDelay = RETRY_DELAYS_MS[attempt];
      if (retryDelay == null) break;
      await wait(retryDelay);
    }
  }
  throw lastError;
}
