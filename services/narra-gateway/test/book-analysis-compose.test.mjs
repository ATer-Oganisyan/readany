import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const compose = await readFile(new URL('../compose.i167.yml', import.meta.url), 'utf8')

const stages = {
  prepare: '["node", "book-analysis-worker.mjs"]',
  scan: '["node", "book-analysis-scan-worker-runner.mjs"]',
  resolve: '["node", "book-analysis-resolve-worker-runner.mjs"]',
  synthesize: '["node", "book-analysis-stage-worker-runner.mjs", "synthesize"]',
  validate: '["node", "book-analysis-stage-worker-runner.mjs", "validate"]',
  publish: '["node", "book-analysis-stage-worker-runner.mjs", "publish"]'
}

test('shadow analysis deploys every stage as an independently scalable service', () => {
  assert.match(compose, /profiles: \["book-analysis-shadow"\]/)
  for (const [stage, command] of Object.entries(stages)) {
    const service = `  book-analysis-${stage}:\n`
    assert.ok(compose.includes(service), `missing ${stage} service`)
    assert.ok(compose.includes(`    command: ${command}`), `wrong ${stage} command`)
  }
})

test('shadow analysis workers keep the hardened read-only runtime', () => {
  assert.match(compose, /x-book-analysis-worker: &book-analysis-worker/)
  assert.match(compose, /restart: unless-stopped/)
  assert.match(compose, /read_only: true/)
  assert.match(compose, /no-new-privileges:true/)
})

test('stage services receive only the provider credentials they need', () => {
  const resolve = compose.slice(
    compose.indexOf('  book-analysis-resolve:'),
    compose.indexOf('  book-analysis-synthesize:')
  )
  const publish = compose.slice(
    compose.indexOf('  book-analysis-publish:'),
    compose.indexOf('\nvolumes:')
  )
  assert.match(resolve, /book-analysis-database-environment/)
  assert.doesNotMatch(resolve, /generator-environment|storage-environment/)
  assert.match(publish, /book-analysis-database-environment/)
  assert.doesNotMatch(publish, /generator-environment|storage-environment/)
})
