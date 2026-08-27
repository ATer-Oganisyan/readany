import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";

export interface CoverBookFacts {
  title: string;
  author?: string;
  description?: string;
  excerpt?: string;
  subjects?: string[];
}
export type CoverJobRequest = { book: CoverBookFacts } | { prompt: string };
export interface CoverJobSnapshot {
  jobId: string;
  status: "queued" | "running" | "retry_wait" | "completed" | "failed";
  nextPollAt: number;
  expiresAt?: number;
  errorCode?: string;
  errorMessage?: string;
  base64?: string;
  mimeType?: string;
}
export class CoverJobError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 0,
  ) {
    super(message);
    this.name = "CoverJobError";
  }
}

export function boundedCoverBookFacts(input: CoverBookFacts): CoverBookFacts {
  const limit = (text: string | undefined, max: number) => text?.trim().slice(0, max) || undefined;
  return {
    title: limit(input.title, 500) || "Untitled book",
    author: limit(input.author, 500),
    description: limit(input.description, 2000),
    excerpt: limit(input.excerpt, 2000),
    subjects: input.subjects
      ?.map((value) => limit(value, 120))
      .filter((value): value is string => !!value)
      .slice(0, 32),
  };
}

async function readJob(response: Response, expectedId?: string): Promise<CoverJobSnapshot> {
  const raw = await response.json().catch(() => null);
  if (!response.ok)
    throw new CoverJobError(
      raw?.error || `Cover job HTTP ${response.status}`,
      raw?.code || "HTTP",
      response.status,
    );
  if (
    !raw ||
    typeof raw.job_id !== "string" ||
    !/^[\da-f-]{36}$/i.test(raw.job_id) ||
    (expectedId && raw.job_id !== expectedId) ||
    !["queued", "running", "retry_wait", "completed", "failed"].includes(raw.status)
  ) {
    throw new CoverJobError("Invalid cover job response", "INVALID_RESPONSE");
  }
  const pending = !["completed", "failed"].includes(raw.status);
  const delay = Number.isFinite(raw.poll_after_ms)
    ? Math.min(30_000, Math.max(1000, raw.poll_after_ms))
    : 3000;
  return {
    jobId: raw.job_id,
    status: raw.status,
    nextPollAt: pending ? Date.now() + delay : 0,
    expiresAt: Number.isFinite(raw.expires_at) ? raw.expires_at : undefined,
    errorCode: raw.code,
    errorMessage: raw.error,
    base64: typeof raw.image === "string" ? raw.image : undefined,
    mimeType: raw.mime_type,
  };
}

export async function submitCoverJob(
  request: CoverJobRequest,
  requestId: string,
  signal?: AbortSignal,
): Promise<CoverJobSnapshot> {
  return readJob(
    await narraGatewayRequest("/v2/media/cover/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, request_id: requestId }),
      signal,
    }),
  );
}
export async function getCoverJob(jobId: string, signal?: AbortSignal): Promise<CoverJobSnapshot> {
  return readJob(
    await narraGatewayRequest(`/v2/media/cover/jobs/${encodeURIComponent(jobId)}`, { signal }),
    jobId,
  );
}
export async function acknowledgeCoverJob(jobId: string, signal?: AbortSignal): Promise<void> {
  const response = await narraGatewayRequest(
    `/v2/media/cover/jobs/${encodeURIComponent(jobId)}/ack`,
    { method: "POST", signal },
  );
  // An interrupted ACK may already have deleted the job. Never resubmit it.
  if (response.status === 204 || response.status === 404) return;
  const raw = await response.json().catch(() => null);
  throw new CoverJobError(
    raw?.error || `Cover ACK HTTP ${response.status}`,
    raw?.code || "HTTP",
    response.status,
  );
}

export function coverJobDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new Error("Cover job paused"));
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      },
      Math.max(0, ms),
    );
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
