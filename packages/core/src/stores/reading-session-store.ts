import { create } from "zustand";
import * as db from "../db/database";
import { runWithDbRetry } from "../db/write-retry";
/**
 * Reading session store — session state machine (ACTIVE/PAUSED/STOPPED)
 * Connected to SQLite for persistence via core db module
 */
import type { ReadingSession, ReadingStats, SessionState } from "../types";
import { generateId } from "../utils/generate-id";

async function persistReadingSession(session: ReadingSession): Promise<void> {
  await runWithDbRetry(() => db.insertReadingSession(session));
}

type PendingSessionSave = { snapshot: ReadingSession; promise: Promise<boolean> };
const pendingSessionSaves = new Map<string, PendingSessionSave>();

function hasReadingActivity(session: ReadingSession): boolean {
  return session.totalActiveTime > 0 || session.pagesRead > 0 || (session.charactersRead ?? 0) > 0;
}

/** Counters after the saved boundary belong to a new, non-overlapping segment. */
function unsavedRemainder(current: ReadingSession, saved: ReadingSession): ReadingSession {
  return {
    ...current,
    id: generateId(),
    startedAt: saved.endedAt ?? current.startedAt,
    totalActiveTime: Math.max(0, current.totalActiveTime - saved.totalActiveTime),
    pagesRead: Math.max(0, current.pagesRead - saved.pagesRead),
    charactersRead: Math.max(0, (current.charactersRead ?? 0) - (saved.charactersRead ?? 0)),
  };
}

async function persistStoppedSession(snapshot: ReadingSession): Promise<void> {
  const pending = pendingSessionSaves.get(snapshot.id);
  // An autosave may already own this INSERT ID. Wait for its outcome before
  // writing the fuller stopped snapshot: only its delta remains after success.
  const remainder =
    pending && (await pending.promise) ? unsavedRemainder(snapshot, pending.snapshot) : snapshot;
  if (hasReadingActivity(remainder)) await persistReadingSession(remainder);
}

export interface ReadingSessionState {
  currentSession: ReadingSession | null;
  sessionState: SessionState;
  stats: ReadingStats | null;

  // Actions
  startSession: (bookId: string) => void;
  pauseSession: () => void;
  resumeSession: () => void;
  stopSession: () => void;
  updateActiveTime: () => void;
  incrementPagesRead: (count: number) => void;
  incrementCharactersRead: (count: number) => void;
  loadStats: (bookId: string) => Promise<void>;
  /** Save current session to DB without stopping (for periodic saves) */
  saveCurrentSession: () => Promise<void>;
}

export const useReadingSessionStore = create<ReadingSessionState>((set, get) => ({
  currentSession: null,
  sessionState: "STOPPED",
  stats: null,

  startSession: (bookId) => {
    const session: ReadingSession = {
      id: generateId(),
      bookId,
      state: "ACTIVE",
      startedAt: Date.now(),
      totalActiveTime: 0,
      pagesRead: 0,
      charactersRead: 0,
    };
    set({ currentSession: session, sessionState: "ACTIVE" });
  },

  pauseSession: () =>
    set((state) => ({
      sessionState: "PAUSED",
      currentSession: state.currentSession
        ? { ...state.currentSession, state: "PAUSED", pausedAt: Date.now() }
        : null,
    })),

  resumeSession: () =>
    set((state) => ({
      sessionState: "ACTIVE",
      currentSession: state.currentSession
        ? { ...state.currentSession, state: "ACTIVE", pausedAt: undefined }
        : null,
    })),

  stopSession: () => {
    const { currentSession } = get();
    set({ currentSession: null, sessionState: "STOPPED" });
    if (currentSession && hasReadingActivity(currentSession)) {
      persistStoppedSession({
        ...currentSession,
        state: "STOPPED" as const,
        endedAt: Date.now(),
      }).catch((err) => console.error("Failed to save reading session:", err));
    }
  },

  updateActiveTime: () =>
    set((state) => ({
      currentSession: state.currentSession
        ? {
            ...state.currentSession,
            totalActiveTime: state.currentSession.totalActiveTime + 1000,
          }
        : null,
    })),

  incrementPagesRead: (count) =>
    set((state) => ({
      currentSession: state.currentSession
        ? {
            ...state.currentSession,
            pagesRead: state.currentSession.pagesRead + count,
          }
        : null,
    })),

  incrementCharactersRead: (count) =>
    set((state) => ({
      currentSession: state.currentSession
        ? {
            ...state.currentSession,
            charactersRead: (state.currentSession.charactersRead ?? 0) + count,
          }
        : null,
    })),

  saveCurrentSession: async () => {
    const { currentSession } = get();
    if (!currentSession || !hasReadingActivity(currentSession)) return;
    const pending = pendingSessionSaves.get(currentSession.id);
    if (pending) {
      await pending.promise;
      return;
    }
    const snapshot = { ...currentSession, endedAt: Date.now() };
    const promise = persistReadingSession(snapshot)
      .then(() => {
        set((state) => {
          const live = state.currentSession;
          // A stop or another book may have replaced this segment while the
          // database was busy. Never resurrect it or replace the new session.
          if (live?.id !== snapshot.id || live.bookId !== snapshot.bookId) return state;
          return { currentSession: unsavedRemainder(live, snapshot) };
        });
        return true;
      })
      .catch((err) => {
        console.error("Failed to save reading session:", err);
        return false;
      })
      .finally(() => {
        if (pendingSessionSaves.get(snapshot.id)?.promise === promise)
          pendingSessionSaves.delete(snapshot.id);
      });
    pendingSessionSaves.set(snapshot.id, { snapshot, promise });
    await promise;
  },

  loadStats: async (bookId) => {
    try {
      const sessions = await db.getReadingSessions(bookId);
      const totalReadingTime = sessions.reduce((sum, s) => sum + s.totalActiveTime, 0);
      const totalPagesRead = sessions.reduce((sum, s) => sum + s.pagesRead, 0);
      const totalCharactersRead = sessions.reduce((sum, s) => sum + (s.charactersRead ?? 0), 0);
      const totalSessions = sessions.length;
      const averageSessionTime = totalSessions > 0 ? totalReadingTime / totalSessions : 0;

      const dailyStatsMap = new Map<
        string,
        { readingTime: number; pagesRead: number; charactersRead: number; sessions: number }
      >();
      for (const s of sessions) {
        const day = new Date(s.startedAt).toISOString().split("T")[0];
        const existing = dailyStatsMap.get(day) || {
          readingTime: 0,
          pagesRead: 0,
          charactersRead: 0,
          sessions: 0,
        };
        dailyStatsMap.set(day, {
          readingTime: existing.readingTime + s.totalActiveTime,
          pagesRead: existing.pagesRead + s.pagesRead,
          charactersRead: existing.charactersRead + (s.charactersRead ?? 0),
          sessions: existing.sessions + 1,
        });
      }

      const dailyStats = Array.from(dailyStatsMap.entries()).map(([date, data]) => ({
        date,
        readingTime: data.readingTime,
        pagesRead: data.pagesRead,
        charactersRead: data.charactersRead,
        sessions: data.sessions,
      }));

      const lastSession = sessions[0];
      const lastReadAt = lastSession?.startedAt || 0;

      set({
        stats: {
          bookId,
          totalReadingTime,
          totalPagesRead,
          totalCharactersRead,
          totalSessions,
          averageSessionTime,
          lastReadAt,
          readingStreak: 0,
          dailyStats,
        },
      });
    } catch (err) {
      console.error("Failed to load reading stats:", err);
    }
  },
}));
