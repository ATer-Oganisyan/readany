import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { createCharacterRequestScope } from "./character-request-scope";

function setup() {
  const book = {
    characters: [{ id: "anna" }],
    backendBinding: { bookEditionId: "a", contentSha256: "a".repeat(64), sourceUploaded: false },
  };
  const store = createStore<{ books: Record<string, typeof book> }>(() => ({ books: { book } }));
  let listeners = 0;
  const scope = createCharacterRequestScope({
    bookId: "book",
    characterId: "anna",
    readState: store.getState,
    subscribe: (listener) => {
      listeners++;
      const unsubscribe = store.subscribe(listener);
      return () => {
        listeners--;
        unsubscribe();
      };
    },
  });
  return { store, book, scope, listeners: () => listeners };
}

describe("character request lifetime", () => {
  it.each(["edition", "source"])("permanently cancels observed %s A→B→A", (change) => {
    const { store, book, scope, listeners } = setup();
    store.setState({
      books: {
        book: {
          ...book,
          backendBinding: {
            ...book.backendBinding,
            ...(change === "edition" ? { bookEditionId: "b" } : { contentSha256: "b".repeat(64) }),
          },
        },
      },
    });
    expect(scope.signal.aborted).toBe(true);
    store.setState({ books: { book } });
    expect(scope.isCurrent()).toBe(false);
    expect(listeners()).toBe(0);
  });
  it.each(["book", "character"])("cancels when the %s disappears", (removed) => {
    const { store, book, scope } = setup();
    store.setState({ books: removed === "book" ? {} : { book: { ...book, characters: [] } } });
    expect(scope.signal.aborted).toBe(true);
  });
  it("retains identity across metadata, profile and SHA casing refresh", () => {
    const { store, book, scope, listeners } = setup();
    store.setState({
      books: {
        book: {
          ...book,
          characters: [{ id: "anna" }],
          backendBinding: {
            ...book.backendBinding,
            sourceUploaded: true,
            contentSha256: "A".repeat(64),
          },
        },
      },
    });
    expect(scope.isCurrent()).toBe(true);
    expect(listeners()).toBe(1);
    scope.dispose();
  });
  it("dispose aborts, removes the listener and is idempotent", () => {
    const { scope, listeners } = setup();
    scope.dispose();
    scope.dispose();
    expect(scope.signal.aborted).toBe(true);
    expect(scope.isCurrent()).toBe(false);
    expect(listeners()).toBe(0);
  });
  it("starts aborted without subscribing when the book or character is absent", () => {
    for (const books of [{}, { book: { characters: [] } }]) {
      const store = createStore(() => ({ books }));
      const subscribe = vi.fn(store.subscribe);
      const scope = createCharacterRequestScope({
        bookId: "book",
        characterId: "anna",
        readState: store.getState,
        subscribe,
      });
      expect(scope.signal.aborted).toBe(true);
      expect(subscribe).not.toHaveBeenCalled();
    }
  });
  it("rechecks state synchronously even if notification was not delivered", () => {
    const { store, book } = setup();
    const scope = createCharacterRequestScope({
      bookId: "book",
      characterId: "anna",
      readState: store.getState,
      subscribe: () => () => {},
    });
    store.setState({ books: { book: { ...book, characters: [] } } });
    expect(scope.isCurrent()).toBe(false);
    expect(scope.signal.aborted).toBe(true);
  });
});
