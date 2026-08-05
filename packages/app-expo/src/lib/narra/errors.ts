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
    public readonly technicalDetail?: string,
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
  if (
    /No text could be extracted|extracting a book text sample|book contains no readable|Failed to fetch|Load failed|No book data/i.test(
      detail,
    )
  ) {
    return new NarraServiceError("REQUEST", "Не удалось прочитать текст книги. Попробуйте снова.");
  }
  if (/AI response contains no character JSON|found no characters/i.test(detail)) {
    return new NarraServiceError(
      "SERVICE",
      "Сервис не распознал персонажей в ответе. Попробуйте снова.",
    );
  }
  if (/политик[А-Яа-яЁё]* безопасности|safety|content policy|moderation/iu.test(detail)) {
    return new NarraServiceError(
      "SERVICE",
      "Сервис отклонил эту сцену по правилам безопасности. Попробуйте другую страницу.",
    );
  }
  return new NarraServiceError("SERVICE", "Не получилось. Попробуйте снова.");
}

export function reportNarraError(scope: string, error: unknown): NarraServiceError {
  const normalized = normalizeNarraError(error);
  const detail = error instanceof Error ? error.message : String(error);
  console.warn("[NarraError]", {
    scope,
    code: normalized.code,
    detail,
    requestId: normalized.requestId,
  });
  return normalized.technicalDetail || error === normalized
    ? normalized
    : new NarraServiceError(normalized.code, normalized.message, normalized.requestId, detail);
}
