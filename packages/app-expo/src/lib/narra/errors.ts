export type NarraErrorCode =
  | "AUTH"
  | "CONFIG"
  | "CONNECTION"
  | "RATE"
  | "REQUEST"
  | "SERVICE"
  | "TIMEOUT";

export class NarraServiceError extends Error {
  constructor(
    public readonly code: NarraErrorCode,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "NarraServiceError";
  }
}

export function normalizeNarraError(error: unknown): NarraServiceError {
  if (error instanceof NarraServiceError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  if (/NARRA_GATEWAY_URL|not configured/i.test(detail)) {
    return new NarraServiceError("CONFIG", "Сервис Narra не настроен в этой сборке.");
  }
  if (/^TIMEOUT$|timeout|timed out|aborted/i.test(detail)) {
    return new NarraServiceError("TIMEOUT", "Сервис отвечает дольше обычного. Попробуйте ещё раз.");
  }
  if (/^NETWORK$|xhr|status 0|network request failed|failed to fetch|network error/i.test(detail)) {
    return new NarraServiceError(
      "CONNECTION",
      "Не удалось связаться с сервисом Narra. Проверьте подключение.",
    );
  }
  if (/^AUTH$|401|403|authoriz|auth/i.test(detail)) {
    return new NarraServiceError("AUTH", "Сервис Narra отклонил авторизацию.");
  }
  if (/^RATE$|429|rate|quota|лимит/i.test(detail)) {
    return new NarraServiceError("RATE", "Слишком много запросов. Попробуйте немного позже.");
  }
  if (/^VALIDATION$|validation|400\b/i.test(detail)) {
    return new NarraServiceError("REQUEST", "Не удалось подготовить запрос.");
  }
  return new NarraServiceError("SERVICE", "Не получилось. Попробуйте снова.");
}

export function reportNarraError(scope: string, error: unknown): NarraServiceError {
  const normalized = normalizeNarraError(error);
  console.warn("[NarraError]", {
    scope,
    code: normalized.code,
    detail: error instanceof Error ? error.message : String(error),
    requestId: normalized.requestId,
  });
  return normalized;
}
