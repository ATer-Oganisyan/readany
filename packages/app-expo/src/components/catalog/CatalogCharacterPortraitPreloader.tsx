import { getBundledCatalogCharactersByTitle } from "@/lib/narra/bundled-catalog-characters";
import { ensureCharacterPortrait } from "@/lib/narra/media";
import type { NarraCharacter } from "@/lib/narra/types";
import { useLibraryStore } from "@/stores/library-store";
import { useNarraStore } from "@/stores/narra-store";
import { useEffect } from "react";

interface PortraitJob {
  bookId: string;
  character: NarraCharacter;
}

const portraitQueue = new Map<string, PortraitJob>();
const attemptedPortraits = new Set<string>();
let drainingPortraitQueue = false;

function portraitJobKey(bookId: string, characterId: string): string {
  return `${bookId}:${characterId}`;
}

async function drainPortraitQueue(): Promise<void> {
  if (drainingPortraitQueue) return;
  drainingPortraitQueue = true;
  try {
    while (portraitQueue.size > 0) {
      const entry = portraitQueue.entries().next().value as [string, PortraitJob] | undefined;
      if (!entry) break;
      const [key, job] = entry;
      portraitQueue.delete(key);
      attemptedPortraits.add(key);

      try {
        const portraitUri = await ensureCharacterPortrait(job.bookId, job.character);
        useNarraStore.getState().updateCharacter(job.bookId, job.character.id, { portraitUri });
      } catch (error) {
        console.warn("[Narra] Catalog portrait preload failed", {
          bookId: job.bookId,
          characterId: job.character.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    drainingPortraitQueue = false;
  }
}

function enqueuePortraits(jobs: PortraitJob[]): void {
  for (const job of jobs) {
    const key = portraitJobKey(job.bookId, job.character.id);
    if (!job.character.portraitUri && !attemptedPortraits.has(key) && !portraitQueue.has(key)) {
      portraitQueue.set(key, job);
    }
  }
  void drainPortraitQueue();
}

/** Seeds catalog characters and starts their portraits before the user opens the chat. */
export function CatalogCharacterPortraitPreloader() {
  const books = useLibraryStore((state) => state.books);
  const libraryLoaded = useLibraryStore((state) => state.isLoaded);
  const narraBooks = useNarraStore((state) => state.books);
  const narraHydrated = useNarraStore((state) => state._hasHydrated);
  const setCharacters = useNarraStore((state) => state.setCharacters);

  useEffect(() => {
    if (!libraryLoaded || !narraHydrated) return;
    for (const book of books) {
      const bundledCharacters = getBundledCatalogCharactersByTitle(book.meta.title);
      if (!bundledCharacters?.length) continue;
      if (!(narraBooks[book.id]?.characters.length ?? 0)) {
        setCharacters(book.id, bundledCharacters);
      }
    }
  }, [books, libraryLoaded, narraBooks, narraHydrated, setCharacters]);

  useEffect(() => {
    if (!libraryLoaded || !narraHydrated) return;
    const jobs: PortraitJob[] = [];
    for (const book of books) {
      if (!getBundledCatalogCharactersByTitle(book.meta.title)) continue;
      for (const character of narraBooks[book.id]?.characters ?? []) {
        if (!character.portraitUri) jobs.push({ bookId: book.id, character });
      }
    }
    enqueuePortraits(jobs);
  }, [books, libraryLoaded, narraBooks, narraHydrated]);

  return null;
}
