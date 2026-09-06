import type { Book } from "@readany/core/types";

// One bounded entry per book in the existing library JSON, never in synced DB
// metadata. A later cover/title write must not make an unsaved page look stale.
export interface ReadingProgressCheckpoint {
  version: 1;
  source: string;
  progress: number;
  currentCfi: string;
  updatedAt: number;
  pending: boolean;
}

type CachedBook = Book & { localProgressCheckpoint?: ReadingProgressCheckpoint };

function sourceIdentity(book: Book): string {
  // Backend edition/revision IDs are assigned asynchronously without changing
  // the local bytes. They must not invalidate a pending local reading position.
  return JSON.stringify([book.id, book.format, book.fileHash || book.filePath]);
}

export function getReadingProgressCheckpoint(book?: Book): ReadingProgressCheckpoint | undefined {
  const checkpoint = (book as CachedBook | undefined)?.localProgressCheckpoint;
  if (
    !book ||
    !checkpoint ||
    checkpoint.version !== 1 ||
    checkpoint.source !== sourceIdentity(book) ||
    !Number.isFinite(checkpoint.progress) ||
    checkpoint.progress < 0 ||
    checkpoint.progress > 1 ||
    typeof checkpoint.currentCfi !== "string" ||
    checkpoint.currentCfi.length === 0 ||
    checkpoint.currentCfi.length > 65_536 ||
    !Number.isFinite(checkpoint.updatedAt) ||
    checkpoint.updatedAt <= 0 ||
    typeof checkpoint.pending !== "boolean" ||
    book.progress !== checkpoint.progress ||
    book.currentCfi !== checkpoint.currentCfi
  )
    return undefined;
  return checkpoint;
}

export function withReadingProgressCheckpoint(book: Book): Book {
  if (
    !Number.isFinite(book.progress) ||
    book.progress < 0 ||
    book.progress > 1 ||
    !book.currentCfi ||
    book.currentCfi.length > 65_536
  )
    return book;
  const previous = (book as CachedBook).localProgressCheckpoint;
  const previousTime = previous && Number.isFinite(previous.updatedAt) ? previous.updatedAt : 0;
  const checkpoint: ReadingProgressCheckpoint = {
    version: 1,
    source: sourceIdentity(book),
    progress: book.progress,
    currentCfi: book.currentCfi,
    updatedAt: Math.max(Date.now(), previousTime + 1),
    pending: true,
  };
  return { ...book, localProgressCheckpoint: checkpoint } as CachedBook;
}

export function acknowledgeReadingProgress(book: Book, saved: ReadingProgressCheckpoint): Book {
  const current = getReadingProgressCheckpoint(book);
  if (
    !current ||
    !current.pending ||
    current.source !== saved.source ||
    current.updatedAt !== saved.updatedAt ||
    current.progress !== saved.progress ||
    current.currentCfi !== saved.currentCfi
  )
    return book;
  return { ...book, localProgressCheckpoint: { ...current, pending: false } } as CachedBook;
}

/** Keep DB metadata authoritative; replay only a matching source's exact page. */
export function restoreReadingProgress(
  databaseBook: Book,
  cachedBook?: Book,
  changedDuringLoad = false,
): { book: Book; repair?: ReadingProgressCheckpoint } {
  const checkpoint = getReadingProgressCheckpoint(cachedBook);
  if (!checkpoint || checkpoint.source !== sourceIdentity(databaseBook))
    return { book: databaseBook };
  const samePosition =
    checkpoint.progress === databaseBook.progress &&
    checkpoint.currentCfi === databaseBook.currentCfi;
  if (
    !samePosition &&
    !checkpoint.pending &&
    !changedDuringLoad &&
    checkpoint.updatedAt <= databaseBook.updatedAt
  )
    return { book: databaseBook };
  const restored = { ...checkpoint, pending: !samePosition };
  return {
    book: {
      ...databaseBook,
      progress: checkpoint.progress,
      currentCfi: checkpoint.currentCfi,
      localProgressCheckpoint: restored,
    } as CachedBook,
    repair: samePosition ? undefined : restored,
  };
}

/** Reimport can replace the file path; transfer only an identical source's journal. */
export function preserveReadingProgressCheckpoint(book: Book, current: Book): Book {
  const checkpoint = getReadingProgressCheckpoint(current);
  return {
    ...book,
    localProgressCheckpoint: checkpoint?.source === sourceIdentity(book) ? checkpoint : undefined,
  } as CachedBook;
}
