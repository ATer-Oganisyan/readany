export type NarraErrorCode =
  | "AUTH"
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
  if (/^TIMEOUT$|timeout|timed out|aborted/i.test(detail)) {
    return new NarraServiceError(
      "TIMEOUT",
      "Сервис Narra отвечает дольше обычного. Попробуйте ещё раз.",
    );
  }
  if (/^NETWORK$|xhr|status 0|network request failed|failed to fetch|network error/i.test(detail)) {
    return new NarraServiceError(
      "CONNECTION",
      "Не удалось связаться с сервисом Narra. Проверьте подключение и попробуйте ещё раз.",
    );
  }
  if (/^AUTH$|401|403|authoriz|auth/i.test(detail)) {
    return new NarraServiceError("AUTH", "Не удалось авторизоваться в Narra. Попробуйте ещё раз.");
  }
  if (/^RATE$|429|rate|quota|лимит/i.test(detail)) {
    return new NarraServiceError(
      "RATE",
      "Сейчас слишком много запросов к Narra. Попробуйте немного позже.",
    );
  }
  if (/^VALIDATION$|validation|строка длиной|400\b/i.test(detail)) {
    return new NarraServiceError("REQUEST", "Не удалось подготовить книгу к анализу.");
  }
  return new NarraServiceError("SERVICE", "Narra не смогла выполнить запрос. Попробуйте ещё раз.");
}

export function logNarraError(scope: string, error: NarraServiceError) {
  console.warn("[NarraError]", {
    scope,
    code: error.code,
    requestId: error.requestId,
  });
}

export function reportNarraError(scope: string, error: unknown): NarraServiceError {
  const normalized = normalizeNarraError(error);
  logNarraError(scope, normalized);
  return normalized;
}
