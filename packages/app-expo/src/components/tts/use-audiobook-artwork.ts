import { useResolvedCovers } from "@/screens/notes/useResolvedCovers";
import { useLibraryStore } from "@/stores/library-store";
import { useTTSStore } from "@/stores/tts-store";
import { useMemo } from "react";

/** Generated artwork can arrive after the audio session has already started. */
export function useAudiobookArtwork() {
  const bookId = useTTSStore((s) => s.currentBookId);
  const sessionArtwork = useTTSStore((s) => s.currentArtwork);
  const coverUrl = useLibraryStore(
    (s) => s.books.find((book) => book.id === bookId)?.meta.coverUrl,
  );
  const items = useMemo(() => [{ bookId, coverUrl: coverUrl ?? null }], [bookId, coverUrl]);
  return useResolvedCovers(items).get(bookId) || sessionArtwork;
}
