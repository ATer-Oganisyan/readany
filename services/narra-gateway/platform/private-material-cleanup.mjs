import { createOperationalLogger } from './operational-log.mjs'

function errorCode(error) {
  const value = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
  return /^[A-Z][A-Z0-9_]{1,48}$/.test(value) ? value : 'UNKNOWN'
}

export function createPrivateMaterialCleanup({
  repository,
  storage,
  logger = console,
  batchSize = 100
}) {
  if (!repository || !storage) throw new TypeError('cleanup repository and storage are required')
  const log = createOperationalLogger({ component: 'book-cleanup', logger })
  let running = false

  return {
    async runOnce() {
      if (running) return { status: 'busy' }
      running = true
      try {
        const purge = await repository.purgeExpiredPrivateEditions({ limit: batchSize })
        const objectKeys = await repository.listBookObjectDeletions({ limit: batchSize })
        if (!objectKeys.length) {
          if (purge.deletedEditions) {
            log.info('cleanup.completed', 'Просроченные данные локальных книг удалены', {
              editions: purge.deletedEditions,
              objects: 0
            })
          }
          return { status: 'idle', ...purge, deletedObjects: 0 }
        }
        try {
          await storage.deleteObjects(objectKeys)
          await repository.acknowledgeBookObjectDeletions(objectKeys)
          log.info('cleanup.completed', 'Просроченные данные локальных книг удалены', {
            editions: purge.deletedEditions,
            objects: objectKeys.length
          })
          return { status: 'completed', ...purge, deletedObjects: objectKeys.length }
        } catch (error) {
          const code = errorCode(error)
          await repository.failBookObjectDeletions(objectKeys, code)
          log.error('cleanup.failed', 'Не удалось удалить просроченные объекты; повторю позже', {
            objects: objectKeys.length,
            error_code: code
          })
          return { status: 'failed', ...purge, deletedObjects: 0, errorCode: code }
        }
      } finally {
        running = false
      }
    }
  }
}
