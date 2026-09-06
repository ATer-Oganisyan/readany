import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)

// Resolve through the actual production consumers, including nested npm copies.
// These are dependency regressions, not claims that the gateway exposes every
// optional qs parsing/stringifying configuration used by the advisory examples.
for (const consumer of ['express', 'body-parser']) {
  const consumerRequire = createRequire(require.resolve(`${consumer}/package.json`))
  const qs = consumerRequire('qs')

  test(`${consumer}: an untrusted constructor key cannot crash query serialization`, () => {
    const parsed = qs.parse('x%5Bconstructor%5D%5BisBuffer%5D=y', { plainObjects: true })
    assert.doesNotThrow(() => qs.stringify(parsed))
    assert.equal(qs.stringify({ query: 'Анна', page: 2 }), 'query=%D0%90%D0%BD%D0%BD%D0%B0&page=2')
  })

  test(`${consumer}: bracketed comma arrays respect the configured allocation limit`, () => {
    const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true }
    assert.throws(() => qs.parse('a[]=1,2,3,4', options), RangeError)
    assert.doesNotThrow(() => qs.parse('a[]=1,2,3', options))
  })
}
