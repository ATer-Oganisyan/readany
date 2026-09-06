import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { createBookAnalysisScanWorker } from '../book-analysis-scan-worker.mjs'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const text = 'Анна вошла в комнату.'
const input = {
  runId: 'own-run', extractorVersion: 'own-extractor', normalizedTextObjectKey: 'own-fixture',
  chunk: {
    id: 'own-chunk', ordinal: 0, contextStartOffset: 0, contextEndOffset: text.length,
    coreStartOffset: 0, coreEndOffset: text.length,
    contentHash: createHash('sha256').update(text).digest('hex'),
    metadata: { contextByteStart: 0, contextByteEnd: Buffer.byteLength(text), sectionTitles: [] }
  }
}
const result = { observations: [{
  type: 'character_action', entityKind: 'character', entityCandidate: 'Анна',
  relatedEntityCandidates: [], fact: text,
  evidence: { quote: text, startOffset: 0, endOffset: text.length }, confidence: 1
}] }

for (const mode of ['input', 'storage', 'storage-abort', 'generator', 'generator-abort', 'generator-empty', 'transient', 'renew-pending']) {
  test(`scan lease lifecycle: ${mode}`, async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const entered = deferred(), block = deferred(), renewal = deferred()
    let models = 0, commits = 0, failures = 0, renewals = 0, modelSignal, storageSignal
    const worker = createBookAnalysisScanWorker({
      workerId: 'own-worker', extractorVersion: 'own-extractor', leaseSeconds: 30, leaseRenewMs: 1000,
      logger: { info() {}, error() {}, warn() {} },
      repository: {
        async claimAnalysisJob() { return { id: 'own-job', runId: 'own-run', stage: 'scan', attempts: 3, maxAttempts: 3 } },
        async getScanInput() {
          if (['input', 'transient', 'renew-pending'].includes(mode)) { entered.resolve(); await block.promise }
          return input
        },
        async renewAnalysisJobLease() {
          renewals++
          if (mode === 'renew-pending') return renewal.promise
          throw Object.assign(new Error('own fixture renewal'), { code: mode === 'transient' ? 'ECONNRESET' : 'LEASE_LOST' })
        },
        async completeScan() { commits++; return { stage: 'resolve' } },
        async failAnalysisJob() { failures++; return { status: 'queued' } }
      },
      storage: { async getBytesRange(options) {
        storageSignal = options.signal
        if (mode === 'storage-abort') {
          entered.resolve()
          await new Promise((_, reject) => options.signal.addEventListener('abort',
            () => reject(options.signal.reason), { once: true }))
          assert.fail('aborted storage must not return bytes')
        }
        if (mode === 'storage') { entered.resolve(); await block.promise }
        return { bytes: Buffer.from(text) }
      } },
      generator: { async scanBookChunk(_input, options) {
        models++; modelSignal = options?.signal
        if (mode.startsWith('generator')) { entered.resolve(); await block.promise }
        return result
      } }
    })
    const running = worker.runOnce()
    await entered.promise
    t.mock.timers.tick(1000)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    if (mode === 'renew-pending') {
      t.mock.timers.tick(4000)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    }
    const observedRenewals = renewals
    renewal.resolve()
    if (mode === 'generator-abort') block.reject(new DOMException('Aborted', 'AbortError'))
    else if (mode === 'generator-empty') block.reject(Object.assign(new Error('late empty result'), { code: 'SCAN_EMPTY_OBSERVATIONS' }))
    else if (mode !== 'storage-abort') block.resolve()
    const outcome = await running
    const healthy = ['transient', 'renew-pending'].includes(mode)
    assert.equal(models, healthy || mode.startsWith('generator') ? 1 : 0)
    assert.equal(commits, healthy ? 1 : 0)
    assert.equal(failures, 0, 'old owner must not fail or requeue the replacement job')
    if (mode.startsWith('generator')) assert.equal(modelSignal?.aborted, true)
    if (mode.startsWith('storage')) assert.equal(storageSignal?.aborted, true, 'lease cancellation reaches range storage')
    if (!healthy) assert.equal(outcome.errorCode, 'LEASE_LOST')
    else assert.equal(outcome.status, 'completed')
    assert.equal(observedRenewals, 1, 'heartbeat renewals must not overlap')
    t.mock.timers.tick(5000)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    assert.equal(renewals, 1, 'heartbeat must be cleared on completion')
  })
}
