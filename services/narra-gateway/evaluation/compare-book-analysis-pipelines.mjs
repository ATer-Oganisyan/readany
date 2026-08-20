import { normalizeBookMarkupV3 } from '../book-analysis-contracts.mjs'
import {
  BOOK_ANALYSIS_PIPELINE_EXTERNAL,
  BOOK_ANALYSIS_PIPELINE_NARRA,
  normalizeBookAnalysisPipelineId
} from '../book-analysis-pipeline.mjs'
import { scoreFrozenIdentity } from './score-frozen-identity.mjs'

function comparisonError(message) {
  return Object.assign(new TypeError(message), { code: 'PIPELINE_COMPARISON_INVALID' })
}

function normalizeResult(value, index) {
  const run = value?.run
  const publication = value?.publication
  if (!run || !publication?.data?.markup) {
    throw comparisonError(`results[${index}] must contain a completed run and publication`)
  }
  const pipelineId = normalizeBookAnalysisPipelineId(run.pipelineId)
  const markup = normalizeBookMarkupV3(publication.data.markup)
  if (
    publication.runId !== run.id ||
    publication.data.provenance?.pipelineId !== pipelineId ||
    publication.data.provenance?.pipelineImplementationVersion !==
      run.pipelineImplementationVersion ||
    publication.data.provenance?.sourceContentHash !== run.inputHash
  ) {
    throw comparisonError(`results[${index}] publication provenance does not match its run`)
  }
  return { run, publication, pipelineId, markup }
}

export function compareBookAnalysisPipelines({ fixture, results }) {
  if (!Array.isArray(results) || results.length !== 2) {
    throw comparisonError('results must contain exactly two pipeline results')
  }
  const normalized = results.map(normalizeResult)
  if (normalized[0].run.id === normalized[1].run.id) {
    throw comparisonError('pipeline results must belong to independent runs')
  }
  if (normalized[0].run.inputHash !== normalized[1].run.inputHash) {
    throw comparisonError('pipeline runs must use the same source content hash')
  }
  const byPipeline = new Map(normalized.map((value) => [value.pipelineId, value]))
  if (
    byPipeline.size !== 2 ||
    !byPipeline.has(BOOK_ANALYSIS_PIPELINE_NARRA) ||
    !byPipeline.has(BOOK_ANALYSIS_PIPELINE_EXTERNAL)
  ) {
    throw comparisonError('comparison requires one narra and one external run')
  }
  const scores = Object.fromEntries([
    BOOK_ANALYSIS_PIPELINE_NARRA,
    BOOK_ANALYSIS_PIPELINE_EXTERNAL
  ].map((pipelineId) => {
    const value = byPipeline.get(pipelineId)
    return [pipelineId, {
      runId: value.run.id,
      pipelineImplementationVersion: value.run.pipelineImplementationVersion,
      publicationId: value.publication.id,
      metrics: scoreFrozenIdentity({
        fixture,
        input: { characters: value.markup.characters }
      })
    }]
  }))
  return {
    sourceContentHash: normalized[0].run.inputHash,
    scorer: 'frozen-identity-v1',
    scores
  }
}
