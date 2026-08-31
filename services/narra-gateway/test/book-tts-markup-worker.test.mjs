import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createBookTtsMarkupWorker } from '../book-tts-markup-worker.mjs'

const text = '— Привет, — сказал Иван. — Как дела?'
const hash = createHash('sha256').update(text).digest('hex')
const job = {
  id: 'job-1', bookEditionId: 'book-1', sourcePublicationId: 'publication-1',
  leaseToken: 'lease-1'
}

test('dedicated TTS worker reads published text, attributes speech and publishes a sidecar', async () => {
  let published
  let modelCalls = 0
  const repository = {
    async claimJob() { return job },
    async getJobInput() {
      return {
        ...job,
        title: 'Книга', author: 'Автор', normalizedTextObjectKey: 'normalized.txt',
        normalizedTextHash: hash, sourceMarkupContentHash: 'b'.repeat(64),
        textLength: text.length,
        navigation: { segments: [{ key: 'chapter-1', title: 'Глава 1', index: 0, startOffset: 0, endOffset: text.length }] },
        characters: [{ characterKey: 'character:ivan', name: 'Иван', fullName: 'Иван', aliases: [] }]
      }
    },
    async completeJob(_job, script) { published = script },
    async renewJobLease() {},
    async failJob() { throw new Error('unexpected failure') }
  }
  const worker = createBookTtsMarkupWorker({
    repository,
    storage: { async getBytes() { return { bytes: Buffer.from(text) } } },
    generator: {
      async generateBookTtsMarkup(input) {
        modelCalls += 1
        return {
          assignments: input.coreAtoms.map(({ atomId }) => ({
            atomId, characterKey: 'character:ivan', confidence: 0.95
          }))
        }
      }
    },
    workerId: 'tts-worker-1', leaseSeconds: 60, leaseRenewMs: 1_000,
    logger: { info() {}, error() {} }
  })

  assert.equal((await worker.runOnce()).status, 'completed')
  assert.equal(modelCalls, 1)
  assert.equal(published.sourcePublicationId, 'publication-1')
  assert.equal(published.sections[0].segments.map(({ text }) => text).join(''), text)
  assert.equal(
    published.sections[0].segments.filter(({ kind }) => kind === 'speech')[0].characterKey,
    'character:ivan'
  )
})

test('TTS worker publishes narration without calling LLM when a section has no dialogue', async () => {
  const narration = 'Наступило тихое утро.'
  let modelCalls = 0
  let published
  const worker = createBookTtsMarkupWorker({
    repository: {
      async claimJob() { return job },
      async getJobInput() {
        return {
          ...job, title: 'Книга', author: '', normalizedTextObjectKey: 'normalized.txt',
          normalizedTextHash: createHash('sha256').update(narration).digest('hex'),
          sourceMarkupContentHash: 'b'.repeat(64), textLength: narration.length,
          navigation: null, characters: []
        }
      },
      async completeJob(_job, script) { published = script },
      async renewJobLease() {}, async failJob() { throw new Error('unexpected failure') }
    },
    storage: { async getBytes() { return { bytes: Buffer.from(narration) } } },
    generator: { async generateBookTtsMarkup() { modelCalls += 1 } },
    workerId: 'tts-worker-1', leaseSeconds: 60, leaseRenewMs: 1_000,
    logger: { info() {}, error() {} }
  })
  assert.equal((await worker.runOnce()).status, 'completed')
  assert.equal(modelCalls, 0)
  assert.equal(published.sections[0].segments[0].kind, 'narration')
})
