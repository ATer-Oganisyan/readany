import { useNarraStore } from "@/stores/narra-store";
import type { Book } from "@readany/core/types";
import { type CharacterAnalysisTextFallback, analyzeBookCharacters } from "./character-analysis";
import type { NarraCharacter } from "./types";

const queuedAnalyses = new Map<string, Promise<NarraCharacter[]>>();
let analysisQueue: Promise<unknown> = Promise.resolve();

function storedCharacters(bookId: string): NarraCharacter[] {
  return useNarraStore.getState().books[bookId]?.characters ?? [];
}

export function queueBookCharacterAnalysis(
  book: Book,
  textFallback?: CharacterAnalysisTextFallback,
): Promise<NarraCharacter[]> {
  const stored = storedCharacters(book.id);
  if (stored.length > 0) return Promise.resolve(stored);

  const queued = queuedAnalyses.get(book.id);
  if (queued) return queued;

  const analysis = analysisQueue
    .then(async () => {
      const latest = storedCharacters(book.id);
      if (latest.length > 0) return latest;
      return analyzeBookCharacters(book, textFallback, { origin: "background" });
    })
    .catch((error) => {
      console.warn(`[Narra] Background character analysis failed for ${book.id}:`, error);
      return [];
    })
    .finally(() => {
      if (queuedAnalyses.get(book.id) === analysis) queuedAnalyses.delete(book.id);
    });

  queuedAnalyses.set(book.id, analysis);
  analysisQueue = analysis.catch(() => undefined);
  return analysis;
}
