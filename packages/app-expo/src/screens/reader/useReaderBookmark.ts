/**
 * useReaderBookmark — handles bookmark toggling, pending snippet requests, and bookmark list.
 */
import { type AnnotationState, useAnnotationStore } from "@/stores";
import { generateId } from "@readany/core/utils";
import { useCallback, useMemo, useRef } from "react";

export interface UseReaderBookmarkOptions {
  bookId: string;
  currentCfi: string;
  currentChapter: string;
  requestPageSnippet: () => void;
  onBookmarkAdded?: () => void;
  onBookmarkRemoved?: () => void;
}

export interface UseReaderBookmarkResult {
  isBookmarked: boolean;
  bookBookmarks: AnnotationState["bookmarks"];
  existingBookmark: AnnotationState["bookmarks"][number] | undefined;
  handleToggleBookmark: () => void;
  pendingBookmarkRef: React.RefObject<boolean>;
  onBookmarkSnippet: (text: string) => void;
}

export function useReaderBookmark({
  bookId,
  currentCfi,
  currentChapter,
  requestPageSnippet,
  onBookmarkAdded,
  onBookmarkRemoved,
}: UseReaderBookmarkOptions): UseReaderBookmarkResult {
  const { bookmarks, addBookmark, removeBookmark } = useAnnotationStore();
  const pendingBookmarkRef = useRef(false);

  const existingBookmark = useMemo(
    () => bookmarks.find((b) => b.bookId === bookId && b.cfi === currentCfi),
    [bookmarks, bookId, currentCfi],
  );
  const isBookmarked = !!existingBookmark;

  const bookBookmarks = useMemo(
    () => bookmarks.filter((b) => b.bookId === bookId),
    [bookmarks, bookId],
  );

  const handleToggleBookmark = useCallback(() => {
    if (!currentCfi || !bookId) return;
    if (isBookmarked && existingBookmark) {
      removeBookmark(existingBookmark.id);
      onBookmarkRemoved?.();
    } else {
      pendingBookmarkRef.current = true;
      requestPageSnippet();
      setTimeout(() => {
        if (pendingBookmarkRef.current) {
          pendingBookmarkRef.current = false;
          addBookmark({
            id: generateId(),
            bookId,
            cfi: currentCfi,
            label: undefined,
            chapterTitle: currentChapter || undefined,
            createdAt: Date.now(),
          });
          onBookmarkAdded?.();
        }
      }, 500);
    }
  }, [
    currentCfi,
    bookId,
    isBookmarked,
    existingBookmark,
    currentChapter,
    removeBookmark,
    addBookmark,
    requestPageSnippet,
    onBookmarkAdded,
    onBookmarkRemoved,
  ]);

  const onBookmarkSnippet = useCallback(
    (text: string) => {
      if (pendingBookmarkRef.current) {
        pendingBookmarkRef.current = false;
        if (currentCfi && bookId) {
          addBookmark({
            id: generateId(),
            bookId,
            cfi: currentCfi,
            label: text || undefined,
            chapterTitle: currentChapter || undefined,
            createdAt: Date.now(),
          });
          onBookmarkAdded?.();
        }
      }
    },
    [addBookmark, bookId, currentCfi, currentChapter, onBookmarkAdded],
  );

  return {
    isBookmarked,
    bookBookmarks,
    existingBookmark,
    handleToggleBookmark,
    pendingBookmarkRef,
    onBookmarkSnippet,
  };
}
