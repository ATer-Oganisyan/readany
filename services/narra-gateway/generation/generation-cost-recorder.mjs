function safeErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code)
    ? error.code
    : 'GENERATION_COST_RECORD_FAILED'
}

export function createBestEffortGenerationCostRecorder({ getLedger, logger = console }) {
  if (typeof getLedger !== 'function') throw new TypeError('getLedger must be a function')

  return async function recordGenerationCost(input) {
    if (!input?.context) return { recorded: 0, skipped: 'context_missing' }
    const ledger = getLedger()
    if (!ledger || typeof ledger.record !== 'function') {
      logger.warn?.('[generation-cost] ledger is unavailable; generation result is preserved', {
        request_id: input.requestId
      })
      return { recorded: 0, skipped: 'ledger_unavailable' }
    }
    try {
      return await ledger.record(input)
    } catch (error) {
      logger.warn?.('[generation-cost] recording failed; generation result is preserved', {
        request_id: input.requestId,
        error_code: safeErrorCode(error)
      })
      return { recorded: 0, skipped: 'record_failed' }
    }
  }
}
