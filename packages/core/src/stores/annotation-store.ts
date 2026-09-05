import { create } from "zustand";
import type { HighlightWithBook } from "../db/database";
import * as db from "../db/database";
import { sortAnnotationsByPosition } from "../reader/annotation-order";
/**
 * Annotation store — highlights, notes, bookmarks management
 * Connected to SQLite for persistence via core db module
 */
import type { Bookmark, Highlight, HighlightColor, Note } from "../types";
import { eventBus } from "../utils/event-bus";

export interface HighlightStats {
  totalHighlights: number;
  highlightsWithNotes: number;
  totalBooks: number;
  colorDistribution: Record<string, number>;
  recentCount: number;
}

export interface AnnotationState {
  activeBookId: string | null;
  highlights: Highlight[];
  highlightsWithBooks: HighlightWithBook[];
  notes: Note[];
  bookmarks: Bookmark[];
  stats: HighlightStats | null;

  // Actions
  setHighlights: (highlights: Highlight[]) => void;
  addHighlight: (highlight: Highlight) => Promise<void>;
  updateHighlight: (id: string, updates: Partial<Highlight>) => Promise<void>;
  removeHighlight: (id: string) => void;
  changeHighlightColor: (id: string, color: HighlightColor) => void;

  setNotes: (notes: Note[]) => void;
  addNote: (note: Note) => void;
  updateNote: (id: string, updates: Partial<Note>) => void;
  removeNote: (id: string) => void;

  setBookmarks: (bookmarks: Bookmark[]) => void;
  addBookmark: (bookmark: Bookmark) => Promise<void>;
  removeBookmark: (id: string) => Promise<void>;

  loadAnnotations: (bookId: string) => Promise<void>;
  loadAllHighlights: (limit?: number) => Promise<void>;
  loadAllHighlightsWithBooks: (limit?: number) => Promise<void>;
  loadStats: () => Promise<void>;
}

async function refreshDerivedAnnotationState(
  set: (partial: Partial<AnnotationState>) => void,
  limit = 500,
): Promise<void> {
  try {
    const [highlightsWithBooks, stats] = await Promise.all([
      db.getAllHighlightsWithBooks(limit),
      db.getHighlightStats(),
    ]);
    set({ highlightsWithBooks, stats });
  } catch (err) {
    console.error("Failed to refresh derived annotation state:", err);
  }
}

let highlightSaveQueue: Promise<void> = Promise.resolve();
let annotationLoadGeneration = 0;
let bookmarkWriteQueue: Promise<void> = Promise.resolve();
let bookmarkRevision = 0;

function enqueueBookmarkWrite(operation: () => Promise<void>): Promise<void> {
  bookmarkRevision += 1;
  const saved = bookmarkWriteQueue.then(operation);
  // Legacy callers may ignore the acknowledgement, but editors can await it.
  bookmarkWriteQueue = saved.catch((error) => console.error("Bookmark write failed:", error));
  return saved;
}

async function readCommittedBookmarks(bookId: string): Promise<Bookmark[]> {
  for (;;) {
    const revision = bookmarkRevision;
    await bookmarkWriteQueue;
    const rows = await db.getBookmarks(bookId);
    if (revision === bookmarkRevision) return rows;
  }
}

function enqueueHighlightSave(
  operation: () => Promise<void>,
  failureMessage: string,
): Promise<void> {
  const saved = highlightSaveQueue.then(operation);
  // Observe failures for legacy fire-and-forget callers, while returning the
  // original acknowledgement so editors can retain drafts and offer a retry.
  // Serialize publication/derived refresh with the write, not just its start.
  highlightSaveQueue = saved.catch((error) => console.error(failureMessage, error));
  return saved;
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  activeBookId: null,
  highlights: [],
  highlightsWithBooks: [],
  notes: [],
  bookmarks: [],
  stats: null,

  setHighlights: (highlights) =>
    set((state) => ({
      highlights: sortAnnotationsByPosition(
        highlights.filter(
          (highlight) => state.activeBookId === null || highlight.bookId === state.activeBookId,
        ),
      ),
    })),
  addHighlight: (highlight) => {
    const snapshot = { ...highlight };
    return enqueueHighlightSave(async () => {
      await db.insertHighlight(snapshot);
      set((state) =>
        state.activeBookId === null || state.activeBookId === snapshot.bookId
          ? { highlights: sortAnnotationsByPosition([...state.highlights, snapshot]) }
          : {},
      );
      eventBus.emit("annotation:added", {
        bookId: snapshot.bookId,
        annotationId: snapshot.id,
        type: "highlight",
      });
      await refreshDerivedAnnotationState(set);
    }, "Failed to insert highlight:");
  },
  updateHighlight: (id, updates) => {
    const snapshot = { ...updates };
    return enqueueHighlightSave(async () => {
      await db.updateHighlight(id, snapshot);
      set((state) => ({
        highlights: sortAnnotationsByPosition(
          state.highlights
            .map((h) => (h.id === id ? { ...h, ...snapshot } : h))
            .filter((h) => state.activeBookId === null || h.bookId === state.activeBookId),
        ),
        highlightsWithBooks: state.highlightsWithBooks.map((h) =>
          h.id === id ? { ...h, ...snapshot } : h,
        ),
      }));
      await refreshDerivedAnnotationState(set);
    }, "Failed to update highlight:");
  },
  removeHighlight: (id) => {
    set((state) => ({
      highlights: state.highlights.filter((h) => h.id !== id),
      highlightsWithBooks: state.highlightsWithBooks.filter((h) => h.id !== id),
    }));
    db.deleteHighlight(id)
      .then(async () => {
        eventBus.emit("annotation:removed", { id, type: "highlight" });
        await refreshDerivedAnnotationState(set);
      })
      .catch((err) => console.error("Failed to delete highlight:", err));
  },
  changeHighlightColor: (id, color) => {
    set((state) => ({
      highlights: sortAnnotationsByPosition(
        state.highlights.map((h) => (h.id === id ? { ...h, color, updatedAt: Date.now() } : h)),
      ),
      highlightsWithBooks: state.highlightsWithBooks.map((h) =>
        h.id === id ? { ...h, color, updatedAt: Date.now() } : h,
      ),
    }));
    db.updateHighlight(id, { color })
      .then(async () => {
        await refreshDerivedAnnotationState(set);
      })
      .catch((err) => console.error("Failed to update highlight color:", err));
  },

  setNotes: (notes) => set({ notes: sortAnnotationsByPosition(notes) }),
  addNote: (note) => {
    set((state) => ({ notes: sortAnnotationsByPosition([...state.notes, note]) }));
    db.insertNote(note).catch((err) => console.error("Failed to insert note:", err));
  },
  updateNote: (id, updates) => {
    set((state) => ({
      notes: sortAnnotationsByPosition(
        state.notes.map((n) => (n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n)),
      ),
    }));
    db.updateNote(id, updates).catch((err) => console.error("Failed to update note:", err));
  },
  removeNote: (id) => {
    set((state) => ({ notes: state.notes.filter((n) => n.id !== id) }));
    db.deleteNote(id).catch((err) => console.error("Failed to delete note:", err));
  },

  setBookmarks: (bookmarks) => set({ bookmarks: sortAnnotationsByPosition(bookmarks) }),
  addBookmark: (bookmark) => {
    const snapshot = { ...bookmark };
    return enqueueBookmarkWrite(async () => {
      await db.insertBookmark(snapshot);
      set((state) =>
        state.activeBookId === null || state.activeBookId === snapshot.bookId
          ? {
              bookmarks: sortAnnotationsByPosition([
                ...state.bookmarks.filter((item) => item.id !== snapshot.id),
                snapshot,
              ]),
            }
          : {},
      );
      eventBus.emit("annotation:added", {
        bookId: snapshot.bookId,
        annotationId: snapshot.id,
        type: "bookmark",
      });
    });
  },
  removeBookmark: (id) => {
    return enqueueBookmarkWrite(async () => {
      await db.deleteBookmark(id);
      set((state) => ({ bookmarks: state.bookmarks.filter((b) => b.id !== id) }));
      eventBus.emit("annotation:removed", { id, type: "bookmark" });
    });
  },

  loadAnnotations: async (bookId) => {
    const generation = ++annotationLoadGeneration;
    // A read belongs to the requested book as soon as it starts. Never leave
    // the previous book's overlays visible while the new query is pending or
    // failed, and never let an older request publish into a newer reader.
    if (get().activeBookId !== bookId) {
      set({ activeBookId: bookId, highlights: [], notes: [], bookmarks: [] });
    }
    try {
      const [highlights, notes] = await Promise.all([
        db.getHighlights(bookId),
        db.getNotes(bookId),
      ]);
      const bookmarks = await readCommittedBookmarks(bookId);
      if (generation !== annotationLoadGeneration || get().activeBookId !== bookId) return;
      set({
        highlights: sortAnnotationsByPosition(highlights.filter((item) => item.bookId === bookId)),
        notes: sortAnnotationsByPosition(notes.filter((item) => item.bookId === bookId)),
        bookmarks: sortAnnotationsByPosition(bookmarks.filter((item) => item.bookId === bookId)),
      });
    } catch (err) {
      console.error("Failed to load annotations:", err);
    }
  },

  loadAllHighlights: async (limit = 500) => {
    const generation = ++annotationLoadGeneration;
    set({ activeBookId: null, highlights: [], notes: [], bookmarks: [] });
    try {
      const highlights = await db.getAllHighlights(limit);
      if (generation !== annotationLoadGeneration) return;
      set({ highlights: sortAnnotationsByPosition(highlights) });
    } catch (err) {
      console.error("Failed to load all highlights:", err);
    }
  },

  loadAllHighlightsWithBooks: async (limit = 500) => {
    try {
      const highlightsWithBooks = await db.getAllHighlightsWithBooks(limit);
      set({ highlightsWithBooks });
    } catch (err) {
      console.error("Failed to load highlights with books:", err);
    }
  },

  loadStats: async () => {
    try {
      const stats = await db.getHighlightStats();
      set({ stats });
    } catch (err) {
      console.error("Failed to load highlight stats:", err);
    }
  },
}));
