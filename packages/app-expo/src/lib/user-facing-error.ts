export function userFacingError(
  _error: unknown,
  fallback = "Не удалось выполнить операцию. Попробуйте ещё раз.",
): string {
  // Never expose provider, transport, storage or runtime exception text in UI.
  // Detailed errors remain available only in the sanitized diagnostic logs.
  return fallback;
}
