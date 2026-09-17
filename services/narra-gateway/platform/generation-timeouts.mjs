export const INTERNAL_GENERATION_TIMEOUT_MS = 10 * 60_000
export const PORTRAIT_CASCADE_RESERVE_MS = 2 * 60_000
export const PORTRAIT_CASCADE_MAX_BUDGET_MS =
  INTERNAL_GENERATION_TIMEOUT_MS - PORTRAIT_CASCADE_RESERVE_MS

export function portraitCascadeBudgetMs(deadlineAt, now = performance.now()) {
  return Number.isFinite(deadlineAt)
    ? Math.min(PORTRAIT_CASCADE_MAX_BUDGET_MS, deadlineAt - now - PORTRAIT_CASCADE_RESERVE_MS)
    : PORTRAIT_CASCADE_MAX_BUDGET_MS
}
