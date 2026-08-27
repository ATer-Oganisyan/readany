import assert from 'node:assert/strict'
import test from 'node:test'
import { createBookAnalysisPrepareWorker } from '../book-analysis-prepare-worker.mjs'
import { createBookAnalysisPublishWorker } from '../book-analysis-publish-worker.mjs'
import { createBookAnalysisResolveWorker } from '../book-analysis-resolve-worker.mjs'
import { createBookAnalysisScanWorker } from '../book-analysis-scan-worker.mjs'
import { createBookAnalysisSynthesizeWorker } from '../book-analysis-synthesize-worker.mjs'
import { createBookAnalysisValidateWorker } from '../book-analysis-validate-worker.mjs'

const runIds = ['123e4567-e89b-42d3-a456-426614174099']
const quietLogger = { info() {}, error() {} }

test('every analysis stage passes the configured run allowlist to its queue claim', async () => {
  const claims = []
  const repository = {
    async claimAnalysisJob(workerId, options) {
      claims.push({ workerId, options })
      return null
    }
  }
  const common = {
    repository,
    workerId: 'scoped-worker',
    runIds,
    leaseSeconds: 60,
    leaseRenewMs: 1_000,
    logger: quietLogger
  }
  const workers = [
    createBookAnalysisPrepareWorker({ ...common, storage: {} }),
    createBookAnalysisScanWorker({
      ...common,
      storage: { async getBytesRange() {} },
      generator: { async scanBookChunk() {} }
    }),
    createBookAnalysisResolveWorker(common),
    createBookAnalysisSynthesizeWorker({ ...common, generator: {} }),
    createBookAnalysisValidateWorker({ ...common, storage: {} }),
    createBookAnalysisPublishWorker(common)
  ]

  for (const worker of workers) assert.deepEqual(await worker.runOnce(), { status: 'idle' })

  assert.deepEqual(claims.map(({ options }) => options.stages[0]), [
    'prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish'
  ])
  assert.ok(claims.every(({ options }) => options.runIds === runIds))
})
