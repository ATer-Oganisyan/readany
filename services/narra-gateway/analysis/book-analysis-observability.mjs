export function bookAnalysisLogContext(job, {
  startedAt,
  terminalStatus,
  errorCode
} = {}) {
  const duration = typeof startedAt === 'number'
    ? Math.max(0, Math.round(performance.now() - startedAt))
    : undefined
  return {
    run_id: job?.runId,
    pipeline_id: job?.pipelineId,
    pipeline_version: job?.pipelineImplementationVersion,
    source_hash: job?.sourceHash,
    duration_ms: duration,
    terminal_status: terminalStatus,
    error_code: errorCode
  }
}

/**
 * Сообщение об ошибке для лога.
 *
 * Сначала оно писалось только у ошибок без кода: считалось, что код и есть
 * причина. `CHARACTER_CARD_INVALID` это опровергает — под одним кодом восемь
 * разных причин (цитата вне окна, чужой фрагмент, неизвестный фрагмент,
 * утверждение без ссылок и так далее), и по коду не сказать, какая. Так же
 * устроены `VALIDATION` и `GENERATION_RESULT_INVALID`.
 *
 * Поэтому сообщение идёт в лог всегда и всегда обрезается: в лог попадает
 * причина, а не содержимое книги.
 */
export function unexpectedErrorMessage(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  return message ? message.slice(0, 200) : null
}
