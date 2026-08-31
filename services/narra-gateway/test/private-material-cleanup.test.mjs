import assert from 'node:assert/strict'
import test from 'node:test'
import { createPrivateMaterialCleanup } from '../private-material-cleanup.mjs'

test('private material cleanup purges expired rows and their S3 objects', async () => {
  const calls = []
  const cleanup = createPrivateMaterialCleanup({
    repository: {
      async purgeExpiredPrivateEditions() {
        calls.push('purge')
        return { deletedEditions: 2 }
      },
      async listBookObjectDeletions() {
        calls.push('list')
        return ['private/a.png', 'private/a.mp3']
      },
      async acknowledgeBookObjectDeletions(keys) {
        calls.push(['ack', keys])
      }
    },
    storage: {
      async deleteObjects(keys) {
        calls.push(['delete', keys])
      }
    },
    logger: { info() {}, error() {} }
  })
  assert.deepEqual(await cleanup.runOnce(), {
    status: 'completed', deletedEditions: 2, deletedObjects: 2
  })
  assert.deepEqual(calls, [
    'purge', 'list',
    ['delete', ['private/a.png', 'private/a.mp3']],
    ['ack', ['private/a.png', 'private/a.mp3']]
  ])
})
