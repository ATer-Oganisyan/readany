import {
  BackendBookError,
  backendBookPath,
  backendBookRequest,
  backendJsonPost,
} from "./backend-book-api";
import { backendRecord } from "./backend-book-contract";
import type { BackendSceneIntent } from "./backend-scene-identity";
export {
  type BackendSceneIntent,
  backendSceneId,
  backendSceneMarkupIdentity,
} from "./backend-scene-identity";

export interface BackendSceneSnapshot {
  status: "queued" | "running" | "ready" | "failed";
  sceneKey: string;
  slotIndex: number;
  anchorTextOffset: number;
  pollAfterMs: number;
  imageUrl?: string;
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  errorCode?: string;
}
export class BackendSceneError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "BackendSceneError";
  }
}

export function isBackendSceneReady(
  bookEditionId: string | undefined,
  availability: string | undefined,
): boolean {
  return Boolean(bookEditionId) && availability === "ready";
}

export function parseBackendScene(value: unknown): BackendSceneSnapshot {
  const raw = backendRecord(value);
  if (raw.error_code === "MARKUP_PROCESSING") {
    throw new BackendSceneError("MARKUP_PROCESSING");
  }
  if (raw.status === "failed") {
    const code =
      typeof raw.error_code === "string" && /^[A-Z0-9_]{1,80}$/.test(raw.error_code)
        ? raw.error_code
        : "SCENE_FAILED";
    throw new BackendSceneError(code);
  }
  if (raw.status !== "queued" && raw.status !== "running" && raw.status !== "ready")
    throw new BackendSceneError("SCENE_INVALID_RESPONSE");
  if (
    typeof raw.scene_key !== "string" ||
    !raw.scene_key ||
    !Number.isSafeInteger(raw.slot_index) ||
    Number(raw.slot_index) < 0 ||
    !Number.isSafeInteger(raw.anchor_text_offset) ||
    Number(raw.anchor_text_offset) < 0
  )
    throw new BackendSceneError("SCENE_INVALID_RESPONSE");
  if (
    raw.status === "ready" &&
    (typeof raw.image_url !== "string" ||
      !/^https?:\/\//.test(raw.image_url) ||
      !["image/png", "image/jpeg", "image/webp"].includes(String(raw.mime_type)))
  )
    throw new BackendSceneError("SCENE_INVALID_ASSET");
  return {
    status: raw.status,
    sceneKey: raw.scene_key,
    slotIndex: Number(raw.slot_index),
    anchorTextOffset: Number(raw.anchor_text_offset),
    pollAfterMs:
      typeof raw.poll_after_ms === "number" && Number.isFinite(raw.poll_after_ms)
        ? Math.max(250, raw.poll_after_ms)
        : 2000,
    imageUrl: typeof raw.image_url === "string" ? raw.image_url : undefined,
    mimeType: raw.mime_type as BackendSceneSnapshot["mimeType"],
  };
}

export async function requestBackendSceneAt(
  edition: string,
  progress: number,
  signal?: AbortSignal,
  retryFailed = false,
) {
  if (!edition || !Number.isFinite(progress) || progress < 0 || progress > 1)
    throw new BackendSceneError("SCENE_INVALID_POSITION");
  return parseBackendScene(
    await boundedSceneOperation(
      async (activeSignal) => {
        const post = (retry: boolean) =>
          backendBookRequest(
            backendBookPath(edition, "scenes/at"),
            backendJsonPost(
              { progress_fraction: progress, ...(retry ? { retry_failed: true } : {}) },
              activeSignal,
            ),
          );
        try {
          return await post(retryFailed);
        } catch (error) {
          const payload = error instanceof BackendBookError ? backendRecord(error.payload) : {};
          if (
            !retryFailed ||
            !(error instanceof BackendBookError) ||
            error.status !== 400 ||
            payload.code !== "VALIDATION" ||
            (payload.error ?? payload.message) !== "body.retry_failed: unknown field"
          )
            throw error;
          // Older gateways reject unknown keys. Their legacy endpoint already
          // retries failed jobs; this fallback only preserves rollout compatibility.
          throwIfAborted(activeSignal);
          return post(false);
        }
      },
      SCENE_REQUEST_TIMEOUT_MS,
      signal,
    ),
  );
}

export const BACKEND_SCENE_DEADLINE_MS = 5 * 60 * 1000;
const SCENE_REQUEST_TIMEOUT_MS = 30_000;
export type SceneStage =
  | "request"
  | "queued"
  | "running"
  | "ready"
  | "download"
  | "saved"
  | "retry"
  | "recovery"
  | "failed"
  | "aborted";
interface SceneDependencies {
  request(
    edition: string,
    progress: number,
    signal?: AbortSignal,
    retryFailed?: boolean,
  ): Promise<BackendSceneSnapshot>;
  save(snapshot: BackendSceneSnapshot, signal?: AbortSignal): Promise<string>;
  onSnapshot?(snapshot: BackendSceneSnapshot): void;
  trace?(stage: SceneStage, attempt: number, code?: number): void;
  now?(): number;
  wait?(ms: number, signal?: AbortSignal): Promise<void>;
}
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new BackendSceneError("SCENE_ABORTED");
}

/** Settle even if a native request ignores AbortSignal; late results are discarded. */
export function boundedSceneOperation<T>(
  start: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value as T);
    };
    const abort = () => {
      finish(new BackendSceneError("SCENE_ABORTED"));
      controller.abort();
    };
    const timer = setTimeout(
      () => {
        finish(new BackendSceneError("SCENE_REQUEST_TIMEOUT"));
        controller.abort();
      },
      Math.max(1, timeoutMs),
    );
    signal?.addEventListener("abort", abort, { once: true });
    try {
      start(controller.signal).then(
        (value) => finish(undefined, value),
        (error) => finish(error),
      );
    } catch (error) {
      finish(error);
    }
  });
}
export function waitForScenePoll(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new BackendSceneError("SCENE_ABORTED"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
function terminal(error: unknown) {
  return (
    (error instanceof BackendSceneError && error.code !== "SCENE_REQUEST_TIMEOUT") ||
    (error instanceof BackendBookError && [400, 404, 409, 422].includes(error.status))
  );
}

/** Called only by a user action. Every retry keeps the original position and server slot. */
export async function resolveBackendScene(
  intent: BackendSceneIntent,
  deps: SceneDependencies,
  signal?: AbortSignal,
) {
  const { bookEditionId, requestedProgress } = intent;
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? waitForScenePoll;
  const deadline = now() + BACKEND_SCENE_DEADLINE_MS;
  let sceneKey = intent.sceneKey;
  let attempt = 0;
  const poll = async (recovery = false) => {
    throwIfAborted(signal);
    attempt += 1;
    deps.trace?.(recovery ? "recovery" : "request", attempt);
    const pollDeadline = recovery ? now() + SCENE_REQUEST_TIMEOUT_MS : deadline;
    const allowance = () => Math.max(1, Math.min(SCENE_REQUEST_TIMEOUT_MS, pollDeadline - now()));
    const snapshot = await boundedSceneOperation(
      (activeSignal) => deps.request(bookEditionId, requestedProgress, activeSignal, attempt === 1),
      allowance(),
      signal,
    );
    throwIfAborted(signal);
    if (snapshot.status === "failed") throw new BackendSceneError("SCENE_FAILED");
    if (sceneKey && snapshot.sceneKey !== sceneKey)
      throw new BackendSceneError("SCENE_SLOT_CHANGED");
    sceneKey = snapshot.sceneKey;
    deps.onSnapshot?.(snapshot);
    deps.trace?.(snapshot.status, attempt);
    if (snapshot.status === "ready") {
      deps.trace?.("download", attempt);
      const imageUri = await boundedSceneOperation(
        (activeSignal) => deps.save(snapshot, activeSignal),
        allowance(),
        signal,
      );
      throwIfAborted(signal);
      deps.trace?.("saved", attempt);
      return { ready: true as const, imageUri, snapshot };
    }
    return { ready: false as const, delay: Math.max(250, snapshot.pollAfterMs) };
  };
  try {
    while (now() < deadline) {
      let delay = 2000;
      try {
        const result = await poll();
        if (result.ready) return result;
        delay = result.delay;
      } catch (error) {
        throwIfAborted(signal);
        if (terminal(error)) throw error;
        deps.trace?.(
          "retry",
          attempt,
          error instanceof BackendBookError ? error.status : undefined,
        );
      }
      const remaining = deadline - now();
      if (remaining > 0) await wait(Math.min(delay, remaining), signal);
    }
    // Exactly one recovery even when iOS suspended timers beyond the wall-clock deadline.
    const recovered = await poll(true);
    if (recovered.ready) return recovered;
    throw new BackendSceneError("SCENE_TIMEOUT");
  } catch (error) {
    deps.trace?.(
      signal?.aborted ? "aborted" : "failed",
      attempt,
      error instanceof BackendBookError ? error.status : undefined,
    );
    if (signal?.aborted) throw new BackendSceneError("SCENE_ABORTED");
    if (error instanceof BackendSceneError && error.code === "SCENE_REQUEST_TIMEOUT")
      throw new BackendSceneError("SCENE_TIMEOUT");
    if (terminal(error)) throw error;
    // Preserve the actual recovery failure instead of mislabelling it a failed backend job.
    throw error;
  }
}
