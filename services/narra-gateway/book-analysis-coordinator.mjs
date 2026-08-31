import {
  BOOK_ANALYSIS_PIPELINE_NARRA,
  getBookAnalysisPipeline
} from './book-analysis-pipeline.mjs'

export function createBookAnalysisCoordinator({
  repository,
  defaultPipelineId = BOOK_ANALYSIS_PIPELINE_NARRA
}) {
  if (!repository || typeof repository.ensureAnalysisRun !== 'function') {
    throw new TypeError('book analysis repository is required')
  }
  return {
    async start({
      bookEditionId,
      contentSha256,
      pipelineId = defaultPipelineId,
      priority = 50
    }) {
      const strategy = getBookAnalysisPipeline(pipelineId)
      const result = await repository.ensureAnalysisRun({
        bookEditionId,
        inputHash: contentSha256,
        pipelineId: strategy.id,
        pipelineVersion: strategy.orchestrationVersion,
        promptVersion: strategy.extractorVersion,
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
