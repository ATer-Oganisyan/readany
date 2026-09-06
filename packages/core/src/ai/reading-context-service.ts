/**
 * Reading Context Service
 *
 * Tracks user's current reading state including:
 * - Current chapter and position
 * - Text selection
 * - Recent highlights
 * - Reading progress
 *
 * Provides real-time context for AI tools.
 */
import { useEffect, useState } from "react";
import { getHighlights } from "../db/database";
import { getPlatformService } from "../services/platform";
import type { ReadingContext } from "../types/chat";

type ReadingContextListener = (context: ReadingContext | null) => void;

const STORE_DIR = "readany-store";
const SNAPSHOT_FILE = "reader-context.json";

class ReadingContextService {
  private context: ReadingContext | null = null;
  private listeners: Set<ReadingContextListener> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotWriteQueue: Promise<void> = Promise.resolve();
  private contextGeneration = 0;

  subscribe(listener: ReadingContextListener): () => void {
    this.listeners.add(listener);
    listener(this.context);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener(this.context);
  }

  private debouncedNotify() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.notify();
      this.debounceTimer = null;
    }, 50);
  }

  private scheduleSnapshotWrite(): void {
    const snapshot = this.context;
    this.snapshotWriteQueue = this.snapshotWriteQueue.then(
      () => this.writeSnapshot(snapshot),
      () => this.writeSnapshot(snapshot),
    );
  }

  async flushSnapshot(): Promise<void> {
    await this.snapshotWriteQueue;
  }

  private async writeSnapshot(snapshot: ReadingContext | null): Promise<void> {
    try {
      const platform = getPlatformService();
      const dataDir = await platform.getDataDir();
      const dir = await platform.joinPath(dataDir, STORE_DIR);
      await platform.mkdir(dir);
      const filePath = await platform.joinPath(dir, SNAPSHOT_FILE);
      if (!snapshot) {
        if (await platform.exists(filePath)) {
          await platform.deleteFile(filePath);
        }
        return;
      }
      await platform.writeTextFile(filePath, JSON.stringify(snapshot));
    } catch (error) {
      console.warn("[ReadingContext] Failed to persist context snapshot:", error);
    }
  }

  getContext(): ReadingContext | null {
    return this.context;
  }

  async updateContext(partial: Partial<ReadingContext>): Promise<void> {
    if (!partial.bookId) {
      this.clearContext();
      return;
    }

    const now = Date.now();

    if (!this.context || this.context.bookId !== partial.bookId) {
      const generation = ++this.contextGeneration;
      // Page capture and character navigation must not wait for SQLite. Publish
      // the live page now; a later lookup may enrich only this reader session.
      this.context = {
        bookId: partial.bookId,
        bookTitle: partial.bookTitle || "",
        currentChapter: partial.currentChapter || { index: 0, title: "", href: "" },
        currentPosition: partial.currentPosition || { cfi: "", percentage: 0 },
        surroundingText: partial.surroundingText || "",
        recentHighlights: [],
        operationType: partial.operationType || "reading",
        timestamp: now,
      };
      this.debouncedNotify();
      this.scheduleSnapshotWrite();

      try {
        const highlights = await getHighlights(partial.bookId);
        if (generation !== this.contextGeneration || this.context?.bookId !== partial.bookId) {
          return;
        }
        // Preserve page turns, selection and captured text received while the
        // lookup was pending, including updates within the same book.
        this.context = {
          ...this.context,
          recentHighlights: highlights.slice(0, 5).map((highlight) => ({
            text: highlight.text,
            cfi: highlight.cfi,
            note: highlight.note,
          })),
        };
      } catch (error) {
        console.warn("[ReadingContext] Failed to load recent highlights:", error);
        return;
      }
    } else {
      this.context = {
        ...this.context,
        ...partial,
        timestamp: now,
      };
    }

    this.debouncedNotify();
    this.scheduleSnapshotWrite();
  }

  updateSelection(selection: ReadingContext["selection"]): void {
    if (!this.context) return;

    this.context = {
      ...this.context,
      selection,
      operationType: selection ? "selecting" : "reading",
      timestamp: Date.now(),
    };

    this.debouncedNotify();
    this.scheduleSnapshotWrite();
  }

  clearSelection(): void {
    if (!this.context) return;

    this.context = {
      ...this.context,
      selection: undefined,
      operationType: "reading",
      timestamp: Date.now(),
    };

    this.debouncedNotify();
    this.scheduleSnapshotWrite();
  }

  updatePosition(position: Partial<ReadingContext["currentPosition"]>): void {
    if (!this.context) return;

    this.context = {
      ...this.context,
      currentPosition: {
        ...this.context.currentPosition,
        ...position,
      },
      timestamp: Date.now(),
    };

    this.debouncedNotify();
    this.scheduleSnapshotWrite();
  }

  updateChapter(chapter: Partial<ReadingContext["currentChapter"]>): void {
    if (!this.context) return;

    this.context = {
      ...this.context,
      currentChapter: {
        ...this.context.currentChapter,
        ...chapter,
      },
      timestamp: Date.now(),
    };

    this.debouncedNotify();
    this.scheduleSnapshotWrite();
  }

  setOperationType(type: ReadingContext["operationType"]): void {
    if (!this.context) return;

    this.context = {
      ...this.context,
      operationType: type,
      timestamp: Date.now(),
    };

    this.debouncedNotify();
    this.scheduleSnapshotWrite();
  }

  clearContext(): void {
    this.contextGeneration += 1;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.context = null;
    this.notify();
    this.scheduleSnapshotWrite();
  }
}

export const readingContextService = new ReadingContextService();

export function useReadingContext(): ReadingContext | null {
  const [context, setContext] = useState<ReadingContext | null>(() =>
    readingContextService.getContext(),
  );

  useEffect(() => readingContextService.subscribe(setContext), []);

  return context;
}

export function getReadingContextSnapshot(): ReadingContext | null {
  return readingContextService.getContext();
}
