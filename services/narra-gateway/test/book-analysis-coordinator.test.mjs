import assert from 'node:assert/strict'
import test from 'node:test'
import { createBookAnalysisCoordinator } from '../book-analysis-coordinator.mjs'
import {
  BOOK_ANALYSIS_PIPELINE_VERSION,
  BOOK_ANALYSIS_PROMPT_VERSION
} from '../book-analysis-contracts.mjs'

test('coordinator starts one versioned idempotent analysis run', async () => {
  let requested
  const coordinator = createBookAnalysisCoordinator({
    repository: {
      async ensureAnalysisRun(input) {
        requested = input
        return {
          created: true,
          run: { id: 'run-1', stage: 'prepare', status: 'queued' },
          prepareJob: { id: 'job-1' }
        }
      },
      async getAnalysisRun(runId) { return { id: runId, stage: 'prepare', status: 'queued' } }
    }
  })
  assert.deepEqual(await coordinator.start({
    bookEditionId: 'book-1',
    contentSha256: 'a'.repeat(64)
  }), {
    runId: 'run-1',
    stage: 'prepare',
    status: 'queued',
    created: true,
    prepareJobId: 'job-1'
  })
  assert.equal(requested.pipelineVersion, BOOK_ANALYSIS_PIPELINE_VERSION)
  assert.equal(requested.promptVersion, BOOK_ANALYSIS_PROMPT_VERSION)
  assert.equal((await coordinator.status('run-1')).id, 'run-1')
})
