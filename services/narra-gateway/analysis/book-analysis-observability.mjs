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
 * Сообщение об ошибке для лога — и только когда кода у неё нет.
 *
 * Стадийные воркеры логируют `error_code`, и для ошибок с кодом этого
 * достаточно: код и есть причина. Но `UNKNOWN` не говорит ничего. Так,
 * триггер PostgreSQL отбивал переход стадии конвейера карточек, а в логе
 * стояло `error_code="UNKNOWN"` — причину пришлось доставать отдельным
 * прогоном с обёрнутым репозиторием.
 *
 * Сообщение обрезается: в лог идёт причина, а не содержимое книги.
 */
export function unexpectedErrorMessage(error, errorCode) {
  if (errorCode !== 'UNKNOWN') return null
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  return message ? message.slice(0, 200) : null
}
