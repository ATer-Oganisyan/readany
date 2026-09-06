import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingSession } from "../types";

const runtime = vi.hoisted(() => ({ insert: vi.fn(), rows: new Map<string, ReadingSession>() }));
vi.mock("../db/database", () => ({ insertReadingSession: runtime.insert }));
vi.mock("./sync-store", () => ({ useSyncStore: { getState: () => ({ status: "idle" }) } }));
import { useReadingSessionStore } from "./reading-session-store";

function commit(session: ReadingSession) {
  if (runtime.rows.has(session.id))
    throw new Error("UNIQUE constraint failed: reading_sessions.id");
  runtime.rows.set(session.id, structuredClone(session));
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function delayNextInsert(fail = false) {
  const entered = deferred();
  const gate = deferred();
  runtime.insert.mockImplementationOnce(async (session: ReadingSession) => {
    entered.resolve();
    await gate.promise;
    if (fail) throw new Error("disk full");
    commit(session);
  });
  return { entered: entered.promise, release: gate.resolve };
}
function advance(seconds: number, pages = 0, characters = 0) {
  const store = useReadingSessionStore.getState();
  for (let index = 0; index < seconds; index++) store.updateActiveTime();
  store.incrementPagesRead(pages);
  store.incrementCharactersRead(characters);
}
function totals() {
  return [...runtime.rows.values()].reduce(
    (total, session) => ({
      time: total.time + session.totalActiveTime,
      pages: total.pages + session.pagesRead,
      characters: total.characters + (session.charactersRead ?? 0),
    }),
    { time: 0, pages: 0, characters: 0 },
  );
}
beforeEach(() => {
  runtime.rows.clear();
  runtime.insert.mockReset().mockImplementation(async (session: ReadingSession) => commit(session));
  useReadingSessionStore.setState({ currentSession: null, sessionState: "STOPPED", stats: null });
  useReadingSessionStore.getState().startSession("A");
  advance(3, 2, 200);
});

describe("reading-session persistence owns only its saved segment", () => {
  it("does not replace new book B when a delayed autosave of A completes", async () => {
    const gate = delayNextInsert();
    const pending = useReadingSessionStore.getState().saveCurrentSession();
    await gate.entered;
    useReadingSessionStore.getState().startSession("B");
    advance(1, 1, 100);
    const newer = useReadingSessionStore.getState().currentSession;
    gate.release();
    await pending;
    expect(useReadingSessionStore.getState().currentSession).toBe(newer);
    expect(totals()).toEqual({ time: 3000, pages: 2, characters: 200 });
  });

  it("retains all new ticks, page/character deltas and paused state during a save", async () => {
    const gate = delayNextInsert();
    const pending = useReadingSessionStore.getState().saveCurrentSession();
    await gate.entered;
    advance(2, 3, 300);
    useReadingSessionStore.getState().pauseSession();
    gate.release();
    await pending;
    expect(useReadingSessionStore.getState().currentSession).toMatchObject({
      bookId: "A",
      totalActiveTime: 2000,
      pagesRead: 3,
      charactersRead: 300,
      state: "PAUSED",
    });
    await useReadingSessionStore.getState().saveCurrentSession();
    expect(totals()).toEqual({ time: 5000, pages: 5, characters: 500 });
  });

  it("coalesces concurrent saves of the same segment instead of inserting its ID twice", async () => {
    const gate = delayNextInsert();
    const first = useReadingSessionStore.getState().saveCurrentSession();
    await gate.entered;
    const second = useReadingSessionStore.getState().saveCurrentSession();
    gate.release();
    await Promise.all([first, second]);
    expect(runtime.insert).toHaveBeenCalledTimes(1);
    expect(totals()).toEqual({ time: 3000, pages: 2, characters: 200 });
  });

  it("does not resurrect the stopped session after an in-flight autosave", async () => {
    const gate = delayNextInsert();
    const pending = useReadingSessionStore.getState().saveCurrentSession();
    await gate.entered;
    useReadingSessionStore.getState().stopSession();
    gate.release();
    await pending;
    expect(useReadingSessionStore.getState().currentSession).toBeNull();
    expect(useReadingSessionStore.getState().sessionState).toBe("STOPPED");
    expect(runtime.insert).toHaveBeenCalledTimes(1);
  });

  it("persists stop's fuller snapshot as only the unsaved delta after autosave succeeds", async () => {
    const gate = delayNextInsert();
    const pending = useReadingSessionStore.getState().saveCurrentSession();
    await gate.entered;
    advance(2, 3, 300);
    useReadingSessionStore.getState().stopSession();
    gate.release();
    await pending;
    await vi.waitFor(() => expect(totals()).toEqual({ time: 5000, pages: 5, characters: 500 }));
    expect(runtime.rows.size).toBe(2);
    expect(useReadingSessionStore.getState().currentSession).toBeNull();
  });

  it("keeps new book B while the stopped remainder of A is being saved", async () => {
    const gate = delayNextInsert();
    const pending = useReadingSessionStore.getState().saveCurrentSession();
    await gate.entered;
    advance(2, 3, 300);
    useReadingSessionStore.getState().stopSession();
    useReadingSessionStore.getState().startSession("B");
    advance(1);
    const newer = useReadingSessionStore.getState().currentSession;
    gate.release();
    await pending;
    await vi.waitFor(() => expect(totals()).toEqual({ time: 5000, pages: 5, characters: 500 }));
    expect(useReadingSessionStore.getState().currentSession).toBe(newer);
  });

  it("persists the whole stopped snapshot if its earlier autosave fails", async () => {
    const gate = delayNextInsert(true);
    const pending = useReadingSessionStore.getState().saveCurrentSession();
    await gate.entered;
    advance(2, 3, 300);
    useReadingSessionStore.getState().stopSession();
    gate.release();
    await pending;
    await vi.waitFor(() => expect(totals()).toEqual({ time: 5000, pages: 5, characters: 500 }));
    expect(runtime.rows.size).toBe(1);
    expect(useReadingSessionStore.getState().currentSession).toBeNull();
  });

  it("retains full live counters after failure and allows an explicit retry", async () => {
    const gate = delayNextInsert(true);
    const pending = useReadingSessionStore.getState().saveCurrentSession();
    await gate.entered;
    advance(2, 3, 300);
    gate.release();
    await pending;
    expect(useReadingSessionStore.getState().currentSession).toMatchObject({
      totalActiveTime: 5000,
      pagesRead: 5,
      charactersRead: 500,
    });
    await useReadingSessionStore.getState().saveCurrentSession();
    expect(totals()).toEqual({ time: 5000, pages: 5, characters: 500 });
  });

  it("does not replace a newly started session of the same book", async () => {
    const gate = delayNextInsert();
    const pending = useReadingSessionStore.getState().saveCurrentSession();
    await gate.entered;
    useReadingSessionStore.getState().startSession("A");
    advance(1);
    const newer = useReadingSessionStore.getState().currentSession;
    gate.release();
    await pending;
    expect(useReadingSessionStore.getState().currentSession).toBe(newer);
  });

  it("keeps independent pending saves of A and B isolated", async () => {
    const gate = delayNextInsert();
    const first = useReadingSessionStore.getState().saveCurrentSession();
    await gate.entered;
    useReadingSessionStore.getState().startSession("B");
    advance(1, 1, 100);
    const second = useReadingSessionStore.getState().saveCurrentSession();
    gate.release();
    await Promise.all([first, second]);
    expect([...runtime.rows.values()].map((session) => session.bookId).sort()).toEqual(["A", "B"]);
    expect(totals()).toEqual({ time: 4000, pages: 3, characters: 300 });
    expect(useReadingSessionStore.getState().currentSession).toMatchObject({
      bookId: "B",
      totalActiveTime: 0,
      pagesRead: 0,
      charactersRead: 0,
    });
  });

  it("does not lose page/character deltas between the last timer tick and stop", async () => {
    const gate = delayNextInsert();
    const pending = useReadingSessionStore.getState().saveCurrentSession();
    await gate.entered;
    advance(0, 3, 300);
    useReadingSessionStore.getState().stopSession();
    useReadingSessionStore.getState().stopSession();
    gate.release();
    await pending;
    await vi.waitFor(() => expect(totals()).toEqual({ time: 3000, pages: 5, characters: 500 }));
    expect(runtime.rows.size).toBe(2);
    expect(runtime.insert).toHaveBeenCalledTimes(2);
  });
});
