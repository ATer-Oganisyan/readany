import { readGatewayResponseText } from "@/lib/ai/narra-gateway-consumer";
import { consumeNarraGatewayResponse } from "@/lib/ai/narra-gateway-fetch";
import { backendRecord } from "./backend-book-contract";
import { NarraServiceError } from "./errors";

export class BackendBookError extends NarraServiceError {
  constructor(
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    const raw = backendRecord(payload);
    super(
      status === 401 || status === 403
        ? "AUTH"
        : status === 409 || status === 422
          ? "REQUEST"
          : "SERVICE",
      String(raw.error ?? raw.message ?? `HTTP ${status}`),
      undefined,
      undefined,
      typeof raw.code === "string" ? raw.code : undefined,
    );
  }
}

export async function backendBookRequest(path: string, init: RequestInit = {}) {
  return consumeNarraGatewayResponse(path, init, async (response, scope) => {
    const text = await readGatewayResponseText(response, scope);
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new BackendBookError(response.status, { code: "INVALID_JSON" });
    }
    if (!response.ok) throw new BackendBookError(response.status, payload);
    return backendRecord(payload);
  });
}

export const backendBookPath = (id: string, suffix: string) =>
  `/v2/books/${encodeURIComponent(id)}/${suffix}`;
export const backendJsonPost = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  signal,
});

export function postBackendProgress(id: string, progress: number, signal?: AbortSignal) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1)
    throw new Error("Invalid reading progress");
  return backendBookRequest(
    backendBookPath(id, "progress"),
    backendJsonPost({ progress_fraction: progress }, signal),
  );
}

export function postBackendAnalysisRetry(id: string, requestId: string, signal?: AbortSignal) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
    throw new Error("Invalid analysis retry request id");
  return backendBookRequest(
    backendBookPath(id, "analysis/retry"),
    backendJsonPost({ request_id: requestId }, signal),
  );
}
