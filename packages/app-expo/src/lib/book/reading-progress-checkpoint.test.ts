import type { Book } from "@readany/core/types";
import { describe, expect, it } from "vitest";
import {
  acknowledgeReadingProgress,
  getReadingProgressCheckpoint,
  restoreReadingProgress,
  withReadingProgressCheckpoint,
} from "./reading-progress-checkpoint";

const book: Book = {
  id: "book",
  format: "epub",
  filePath: "books/original.epub",
  fileHash: "original-bytes",
  meta: { title: "Title", author: "Author" },
  progress: 0.2,
  currentCfi: "exact-cfi",
  tags: [],
  addedAt: 1,
  updatedAt: 1,
  isVectorized: false,
  vectorizeProgress: 0,
  syncStatus: "local",
};

const roundTrip = (value: Book): Book => JSON.parse(JSON.stringify(value));

describe("local reading progress checkpoint", () => {
  it("restores matching bytes at a new artifact path without overwriting newer DB metadata", () => {
    const cached = roundTrip(
      withReadingProgressCheckpoint({ ...book, progress: 0.5, currentCfi: "next-cfi" }),
    );
    const database = {
      ...book,
      filePath: "books/reimport.epub",
      updatedAt: Date.now() + 1000,
      meta: { title: "New title", author: "Author", coverUrl: "new.jpg" },
      tags: ["New tag"],
    };
    const result = restoreReadingProgress(database, cached);
    expect(result.book).toMatchObject({ ...database, progress: 0.5, currentCfi: "next-cfi" });
    expect(result.repair).toMatchObject({ pending: true, progress: 0.5, currentCfi: "next-cfi" });
  });

  it.each([{ fileHash: "different-bytes" }, { id: "different-id" }, { format: "pdf" as const }])(
    "never applies an old page to a different source: %j",
    (change) => {
      const cached = roundTrip(withReadingProgressCheckpoint({ ...book, progress: 0.8 }));
      const database = { ...book, ...change };
      expect(restoreReadingProgress(database, cached)).toEqual({ book: database });
    },
  );

  it("keeps the local checkpoint when backend identity arrives for unchanged bytes", () => {
    const pending = roundTrip(withReadingProgressCheckpoint({ ...book, progress: 0.8 }));
    const identity = {
      bookEditionId: "resolved-edition",
      revisionId: "resolved-revision",
      contentHash: "backend-hash",
    };
    const cached = { ...pending, ...identity };
    const database = { ...book, ...identity };
    expect(restoreReadingProgress(database, cached).book).toMatchObject({
      progress: 0.8,
      currentCfi: book.currentCfi,
      ...identity,
    });
  });

  it("uses file path identity conservatively when no byte hash is available", () => {
    const unhashed = { ...book, fileHash: undefined };
    const cached = withReadingProgressCheckpoint({ ...unhashed, progress: 0.8 });
    const database = { ...unhashed, filePath: "other.epub" };
    expect(restoreReadingProgress(database, cached)).toEqual({ book: database });
  });

  it("allows a newer synced database position to replace an acknowledged older checkpoint", () => {
    const cached = withReadingProgressCheckpoint({ ...book, progress: 0.8 });
    const checkpoint = getReadingProgressCheckpoint(cached);
    if (!checkpoint) throw new Error("Missing checkpoint");
    const saved = roundTrip(acknowledgeReadingProgress(cached, checkpoint));
    const database = { ...book, progress: 0.9, updatedAt: checkpoint.updatedAt + 1 };
    expect(restoreReadingProgress(database, saved)).toEqual({ book: database });
  });

  it("acknowledges an already matching DB position without scheduling repeated writes", () => {
    const cached = roundTrip(withReadingProgressCheckpoint(book));
    const result = restoreReadingProgress(book, cached);
    expect(result.repair).toBeUndefined();
    expect(getReadingProgressCheckpoint(result.book)?.pending).toBe(false);
  });

  it("ignores malformed checkpoints and legacy JSON without inventing progress", () => {
    const cached = roundTrip(withReadingProgressCheckpoint(book));
    const checkpoint = getReadingProgressCheckpoint(cached);
    if (!checkpoint) throw new Error("Missing checkpoint");
    for (const invalid of [
      { version: 2 },
      { progress: -1 },
      { progress: 2 },
      { progress: null },
      { currentCfi: "" },
      { currentCfi: "x".repeat(65_537) },
      { updatedAt: -1 },
      { pending: "true" },
    ]) {
      const malformed = { ...cached, localProgressCheckpoint: { ...checkpoint, ...invalid } };
      expect(restoreReadingProgress(book, malformed)).toEqual({ book });
    }
    expect(restoreReadingProgress(book, { ...book, progress: 0.8 })).toEqual({ book });
  });
});
