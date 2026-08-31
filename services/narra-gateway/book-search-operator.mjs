import { createBookEmbeddingClientFromEnv } from './book-embedding-client.mjs'
import { createPostgresBookSearchRepository } from './book-search-repository.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const [command, bookEditionId] = process.argv.slice(2)

if (
  !['enqueue', 'enqueue-graph', 'enqueue-story-arcs'].includes(command) ||
  !UUID.test(String(bookEditionId || ''))
) {
  throw new Error(
    'usage: npm run book-search -- <enqueue|enqueue-graph|enqueue-story-arcs> <book-edition-uuid>'
  )
}

const embeddingClient = createBookEmbeddingClientFromEnv(process.env)
if (command === 'enqueue' && !embeddingClient) {
  throw new Error('BOOK_EMBEDDING_BASE_URL is required')
}
const pool = await createPostgresPoolFromEnv(process.env)
try {
  await runBookMarkupMigrations(pool)
  const repository = createPostgresBookSearchRepository(pool)
  let result
  if (command === 'enqueue') {
    result = await repository.enqueueBook({
        bookEditionId,
        indexVersion: process.env.BOOK_SEARCH_INDEX_VERSION || 'book-search-v1',
        embeddingModel: embeddingClient.model,
        embeddingDimensions: embeddingClient.dimensions
      })
  } else if (command === 'enqueue-graph') {
    result = await repository.enqueueGraph({ bookEditionId })
  } else {
    result = await repository.enqueueStoryArcs({ bookEditionId })
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  await pool.end()
}
