import { getLocalDB, initDatabase } from "@readany/core/db/database";
import type { CoverJobRequest } from "../narra/cover-jobs";

export type LocalCoverJobStatus =
  | "submitting"
  | "queued"
  | "running"
  | "retry_wait"
  | "completed"
  | "failed";

export interface LocalCoverJob {
  bookId: string;
  requestId: string;
  jobId?: string;
  prompt: string;
  request?: CoverJobRequest;
  status: LocalCoverJobStatus;
  nextPollAt: number;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}

interface CoverJobRow {
  book_id: string;
  request_id: string;
  job_id: string | null;
  prompt: string;
  request_body?: string | null;
  status: LocalCoverJobStatus;
  next_poll_at: number;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
}

let mutationChain: Promise<unknown> = Promise.resolve();

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const pending = mutationChain.then(operation, operation);
  mutationChain = pending.catch(() => undefined);
  return pending;
}

function mapRow(row: CoverJobRow): LocalCoverJob {
  return {
    bookId: row.book_id,
    requestId: row.request_id,
    jobId: row.job_id ?? undefined,
    prompt: row.prompt,
    request: row.request_body ? (JSON.parse(row.request_body) as CoverJobRequest) : undefined,
    status: row.status,
    nextPollAt: row.next_poll_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at ?? undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    lastErrorMessage: row.last_error_message ?? undefined,
  };
}

async function selectByBookId(bookId: string): Promise<LocalCoverJob | null> {
  const database = await getLocalDB();
  const rows = await database.select<CoverJobRow>(
    "SELECT * FROM cover_jobs WHERE book_id = ? LIMIT 1",
    [bookId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getOrCreateLocalCoverJob(input: {
  bookId: string;
  requestId: string;
  prompt?: string;
  request?: CoverJobRequest;
  now?: number;
}): Promise<LocalCoverJob> {
  await initDatabase();
  return serial(async () => {
    const existing = await selectByBookId(input.bookId);
    if (existing) return existing;
    const timestamp = input.now ?? Date.now();
    const database = await getLocalDB();
    await database.execute(
      `INSERT OR IGNORE INTO cover_jobs (
        book_id, request_id, prompt, status, next_poll_at, created_at, updated_at, request_body
      ) VALUES (?, ?, ?, 'submitting', 0, ?, ?, ?)`,
      [
        input.bookId,
        input.requestId,
        input.prompt ?? "",
        timestamp,
        timestamp,
        input.request ? JSON.stringify(input.request) : null,
      ],
    );
    const inserted = await selectByBookId(input.bookId);
    if (!inserted) throw new Error("Не удалось сохранить задачу обложки");
    return inserted;
  });
}

export async function updateLocalCoverJob(
  bookId: string,
  update: {
    jobId?: string;
    status: LocalCoverJobStatus;
    nextPollAt?: number;
    expiresAt?: number;
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<LocalCoverJob | null> {
  await initDatabase();
  return serial(async () => {
    const database = await getLocalDB();
    await database.execute(
      `UPDATE cover_jobs SET
        job_id = COALESCE(?, job_id),
        status = ?,
        next_poll_at = ?,
        updated_at = ?,
        expires_at = COALESCE(?, expires_at),
        last_error_code = ?,
        last_error_message = ?
      WHERE book_id = ?`,
      [
        update.jobId ?? null,
        update.status,
        update.nextPollAt ?? 0,
        Date.now(),
        update.expiresAt ?? null,
        update.errorCode ?? null,
        update.errorMessage ?? null,
        bookId,
      ],
    );
    return selectByBookId(bookId);
  });
}

export async function deleteLocalCoverJob(bookId: string): Promise<void> {
  await initDatabase();
  await serial(async () => {
    const database = await getLocalDB();
    await database.execute("DELETE FROM cover_jobs WHERE book_id = ?", [bookId]);
  });
}

export async function getLocalCoverJob(bookId: string): Promise<LocalCoverJob | null> {
  await initDatabase();
  return selectByBookId(bookId);
}
