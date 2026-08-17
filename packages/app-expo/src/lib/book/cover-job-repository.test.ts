import { beforeEach, describe, expect, it, vi } from "vitest";

interface StoredRow {
  book_id: string;
  request_id: string;
  job_id: string | null;
  prompt: string;
  request_body: string | null;
  status: string;
  next_poll_at: number;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
}

const database = vi.hoisted(() => {
  const rows = new Map<string, StoredRow>();
  return {
    rows,
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("INSERT OR IGNORE INTO cover_jobs")) {
        const [bookId, requestId, prompt, requestBody, createdAt, updatedAt] = params as [
          string,
          string,
          string,
          string | null,
          number,
          number,
        ];
        if (!rows.has(bookId)) {
          rows.set(bookId, {
            book_id: bookId,
            request_id: requestId,
            job_id: null,
            prompt,
            request_body: requestBody,
            status: "submitting",
            next_poll_at: 0,
            created_at: createdAt,
            updated_at: updatedAt,
            expires_at: null,
            last_error_code: null,
            last_error_message: null,
          });
        }
        return;
      }
      if (sql.includes("UPDATE cover_jobs SET")) {
        const [jobId, status, nextPollAt, updatedAt, expiresAt, code, message, bookId] = params as [
          string | null,
          string,
          number,
          number,
          number | null,
          string | null,
          string | null,
          string,
        ];
        const row = rows.get(bookId);
        if (row) {
          row.job_id = jobId ?? row.job_id;
          row.status = status;
          row.next_poll_at = nextPollAt;
          row.updated_at = updatedAt;
          row.expires_at = expiresAt ?? row.expires_at;
          row.last_error_code = code;
          row.last_error_message = message;
        }
        return;
      }
      if (sql.includes("DELETE FROM cover_jobs")) rows.delete(String(params[0]));
    }),
    select: vi.fn(async (_sql: string, params: unknown[] = []) => {
      const row = rows.get(String(params[0]));
      return row ? [{ ...row }] : [];
    }),
  };
});

const coreDb = vi.hoisted(() => ({
  getLocalDB: vi.fn(async () => database),
  initDatabase: vi.fn(async () => undefined),
}));

vi.mock("@readany/core/db/database", () => coreDb);

import {
  deleteLocalCoverJob,
  getLocalCoverJob,
  getOrCreateLocalCoverJob,
  updateLocalCoverJob,
} from "./cover-job-repository";

beforeEach(() => {
  database.rows.clear();
  vi.clearAllMocks();
});

describe("local durable cover jobs", () => {
  it("persists the intent before submission and keeps its idempotency key", async () => {
    const first = await getOrCreateLocalCoverJob({
      bookId: "book-1",
      requestId: "request-1",
      request: { book: { title: "First title" } },
      now: 100,
    });
    const repeated = await getOrCreateLocalCoverJob({
      bookId: "book-1",
      requestId: "request-2",
      request: { book: { title: "Changed title" } },
      now: 200,
    });

    expect(first).toMatchObject({
      bookId: "book-1",
      requestId: "request-1",
      request: { book: { title: "First title" } },
      status: "submitting",
    });
    expect(repeated).toEqual(first);
    expect(database.rows.size).toBe(1);
  });

  it("restores the remote job id and poll state from the local database", async () => {
    await getOrCreateLocalCoverJob({
      bookId: "book-1",
      requestId: "request-1",
      request: { book: { title: "Книга" } },
      now: 100,
    });
    await updateLocalCoverJob("book-1", {
      jobId: "job-1",
      status: "retry_wait",
      nextPollAt: 5_000,
      expiresAt: 86_400_000,
      errorCode: "RATE",
      errorMessage: "queue",
    });

    await expect(getLocalCoverJob("book-1")).resolves.toMatchObject({
      requestId: "request-1",
      jobId: "job-1",
      status: "retry_wait",
      nextPollAt: 5_000,
      expiresAt: 86_400_000,
      lastErrorCode: "RATE",
    });
  });

  it("deletes the local pointer after the server result is acknowledged", async () => {
    await getOrCreateLocalCoverJob({
      bookId: "book-1",
      requestId: "request-1",
      request: { book: { title: "Книга" } },
    });
    await deleteLocalCoverJob("book-1");

    await expect(getLocalCoverJob("book-1")).resolves.toBeNull();
  });

  it("restores a legacy client-authored prompt created by an older APK", async () => {
    database.rows.set("book-1", {
      book_id: "book-1",
      request_id: "request-1",
      job_id: "job-1",
      prompt: "legacy prompt",
      request_body: null,
      status: "running",
      next_poll_at: 0,
      created_at: 1,
      updated_at: 1,
      expires_at: null,
      last_error_code: null,
      last_error_message: null,
    });

    await expect(getLocalCoverJob("book-1")).resolves.toMatchObject({
      request: { prompt: "legacy prompt" },
    });
  });
});
