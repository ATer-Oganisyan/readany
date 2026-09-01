import assert from 'node:assert/strict'
import test from 'node:test'
import { parseGenerationQueueCommand } from '../generation-queue-control.mjs'

const EDITION = '11111111-1111-4111-8111-111111111111'
const PAUSE = '22222222-2222-4222-8222-222222222222'

test('queue operator is dry-run by default and requires an explicit bounded selector', () => {
  assert.deepEqual(
    parseGenerationQueueCommand([
      'pause', '--job-type', 'scene_image', '--edition', EDITION,
      '--campaign-id', 'catalog-500-v1', '--limit', '7'
    ]),
    {
      command: 'pause',
      selector: {
        jobType: 'scene_image',
        bookEditionIds: [EDITION],
        campaignId: 'catalog-500-v1'
      },
      limit: 7,
      reasonCode: 'OPERATOR_PAUSED',
      operatorId: 'cli',
      execute: false
    }
  )
  assert.throws(() => parseGenerationQueueCommand(['pause']), { code: 'USAGE' })
  assert.throws(
    () => parseGenerationQueueCommand(['pause', '--job-type', 'scene_image', '--limit', '1001']),
    { code: 'USAGE' }
  )
})

test('queue resume requires one pause id, a bounded limit and explicit execution', () => {
  assert.deepEqual(
    parseGenerationQueueCommand([
      'resume', '--pause-id', PAUSE, '--limit', '25', '--reason', 'CANARY_RELEASE',
      '--operator', 'release-bot', '--execute'
    ]),
    {
      command: 'resume',
      pauseId: PAUSE,
      limit: 25,
      reasonCode: 'CANARY_RELEASE',
      operatorId: 'release-bot',
      execute: true
    }
  )
  assert.throws(() => parseGenerationQueueCommand(['resume', '--pause-id', EDITION, '--limit', '0']), {
    code: 'USAGE'
  })
})
