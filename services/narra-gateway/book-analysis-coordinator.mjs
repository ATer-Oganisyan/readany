import {
  BOOK_ANALYSIS_PIPELINE_VERSION,
  BOOK_ANALYSIS_PROMPT_VERSION
} from './book-analysis-contracts.mjs'

export function createBookAnalysisCoordinator({ repository }) {
  if (!repository || typeof repository.ensureAnalysisRun !== 'function') {
    throw new TypeError('book analysis repository is required')
  }
  return {
    async start({
      bookEditionId,
      contentSha256,
      pipelineVersion = BOOK_ANALYSIS_PIPELINE_VERSION,
      promptVersion = BOOK_ANALYSIS_PROMPT_VERSION,
      priority = 50
    }) {
      const result = await repository.ensureAnalysisRun({
        bookEditionId,
        inputHash: contentSha256,
        pipelineVersion,
        promptVersion,
        priority
      })
      return {
        runId: result.run.id,
        stage: result.run.stage,
        status: result.run.status,
        created: result.created,
        prepareJobId: result.prepareJob.id
      }
    },

    async status(runId) {
      return repository.getAnalysisRun(runId)
    }
  }
}
