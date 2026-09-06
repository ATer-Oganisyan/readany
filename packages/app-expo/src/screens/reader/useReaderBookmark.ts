/** Capture the bookmark at tap time; acknowledge only committed saves. */
import { type AnnotationState, useAnnotationStore } from "@/stores";
import { generateId } from "@readany/core/utils";
import { useCallback, useEffect, useMemo, useRef } from "react";
export interface UseReaderBookmarkOptions {
  bookId: string;
  currentCfi: string;
  currentChapter: string;
  requestPageSnippet: (requestId: string) => void;
  onBookmarkAdded?: () => void;
  onBookmarkRemoved?: () => void;
  onBookmarkError?: (error: unknown) => void;
}
export interface UseReaderBookmarkResult {
  isBookmarked: boolean;
  bookBookmarks: AnnotationState["bookmarks"];
  existingBookmark: AnnotationState["bookmarks"][number] | undefined;
  handleToggleBookmark: () => void;
  pendingBookmarkRef: React.RefObject<boolean>;
  onBookmarkSnippet: (text: string, requestId?: string, cfi?: string) => void;
}
export function useReaderBookmark({
  bookId,
  currentCfi,
  currentChapter,
  requestPageSnippet,
  onBookmarkAdded,
  onBookmarkRemoved,
  onBookmarkError,
}: UseReaderBookmarkOptions): UseReaderBookmarkResult {
  const { bookmarks, addBookmark, removeBookmark } = useAnnotationStore();
  const pendingBookmarkRef = useRef(false);
  const pending = useRef<AnnotationState["bookmarks"][number] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const activeBook = useRef(bookId);
  activeBook.current = bookId;
  const callbacks = useRef({ onBookmarkAdded, onBookmarkRemoved, onBookmarkError });
  callbacks.current = { onBookmarkAdded, onBookmarkRemoved, onBookmarkError };
  const existingBookmark = useMemo(
    () => bookmarks.find((b) => b.bookId === bookId && b.cfi === currentCfi),
    [bookmarks, bookId, currentCfi],
  );
  const bookBookmarks = useMemo(
    () => bookmarks.filter((b) => b.bookId === bookId),
    [bookmarks, bookId],
  );
  const finish = useCallback(
    (text = "", cfi?: string) => {
      const intent = pending.current;
      if (!intent) return;
      pending.current = null;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void (async () => {
        try {
          await addBookmark({ ...intent, label: cfi === intent.cfi && text ? text : undefined });
          if (mounted.current && activeBook.current === intent.bookId)
            callbacks.current.onBookmarkAdded?.();
        } catch (error) {
          if (mounted.current && activeBook.current === intent.bookId)
            callbacks.current.onBookmarkError?.(error);
        } finally {
          pendingBookmarkRef.current = false;
        }
      })();
    },
    [addBookmark],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Persist the explicit action even if the optional label has not arrived.
      finish();
    };
  }, [finish]);
  const handleToggleBookmark = useCallback(() => {
    if (!currentCfi || !bookId || pendingBookmarkRef.current) return;
    pendingBookmarkRef.current = true;
    if (existingBookmark) {
      void (async () => {
        try {
          await removeBookmark(existingBookmark.id);
          if (mounted.current && activeBook.current === bookId)
            callbacks.current.onBookmarkRemoved?.();
        } catch (error) {
          if (mounted.current && activeBook.current === bookId)
            callbacks.current.onBookmarkError?.(error);
        } finally {
          pendingBookmarkRef.current = false;
        }
      })();
      return;
    }
    const intent = {
      id: generateId(),
      bookId,
      cfi: currentCfi,
      chapterTitle: currentChapter || undefined,
      createdAt: Date.now(),
    };
    pending.current = intent;
    timer.current = setTimeout(() => finish(), 500);
    try {
      requestPageSnippet(intent.id);
    } catch {
      finish();
    }
  }, [
    bookId,
    currentCfi,
    currentChapter,
    existingBookmark,
    removeBookmark,
    requestPageSnippet,
    finish,
  ]);
  const onBookmarkSnippet = useCallback(
    (text: string, requestId?: string, cfi?: string) => {
      if (requestId && pending.current?.id === requestId) finish(text, cfi);
    },
    [finish],
  );
  return {
    isBookmarked: !!existingBookmark,
    bookBookmarks,
    existingBookmark,
    handleToggleBookmark,
    pendingBookmarkRef,
    onBookmarkSnippet,
  };
}
