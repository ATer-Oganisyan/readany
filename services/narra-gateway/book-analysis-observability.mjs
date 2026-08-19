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
