import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createBookSearchRouter,
  parseBookGraphSearchQuery,
  parseBookGraphQuery,
  parseBookSearchQuery
} from '../book-search-api.mjs'

test('search query contract is bounded and spoiler-safe by default', () => {
  assert.deepEqual(parseBookSearchQuery({ q: 'тайное озеро' }), {
    query: 'тайное озеро', mode: 'hybrid', spoilerMode: 'reader', limit: 10
  })
  assert.deepEqual(parseBookSearchQuery({
    q: 'герой', mode: 'lexical', spoiler_mode: 'full', limit: '5'
  }), {
    query: 'герой', mode: 'lexical', spoilerMode: 'full', limit: 5
  })
  assert.throws(() => parseBookSearchQuery({ q: 'x' }), /2-500/)
  assert.throws(() => parseBookSearchQuery({ q: 'герой', limit: '21' }), /1 to 20/)
  assert.throws(() => parseBookSearchQuery({ q: 'герой', offset: '1000' }), /unknown/)
})

test('book search router exposes only the authenticated book-scoped route', () => {
  assert.deepEqual(parseBookGraphQuery({}), { spoilerMode: 'reader' })
  assert.deepEqual(parseBookGraphQuery({ spoiler_mode: 'full' }), { spoilerMode: 'full' })
  assert.deepEqual(parseBookGraphSearchQuery({ q: 'отношения героев' }), {
    query: 'отношения героев', mode: 'hybrid', spoilerMode: 'reader', limit: 10, maxHops: 2
  })
  assert.throws(() => parseBookGraphSearchQuery({ q: 'герой', max_hops: '3' }), /1 to 2/)
  const router = createBookSearchRouter({
    service: { async search() {}, async graph() {}, async graphSearch() {} }
  })
  const routes = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path)
  assert.deepEqual(routes, [
    '/:bookEditionId/graph/search', '/:bookEditionId/graph', '/:bookEditionId/search'
  ])
})
