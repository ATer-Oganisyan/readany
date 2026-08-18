import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const compose = await readFile(new URL('../compose.i167.yml', import.meta.url), 'utf8')
const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8')
const gatewaySource = await readFile(new URL('../index.mjs', import.meta.url), 'utf8')

const stages = {
  prepare: '["node", "book-analysis-worker.mjs"]',
  scan: '["node", "book-analysis-scan-worker-runner.mjs"]',
  resolve: '["node", "book-analysis-resolve-worker-runner.mjs"]',
  synthesize: '["node", "book-analysis-stage-worker-runner.mjs", "synthesize"]',
  validate: '["node", "book-analysis-stage-worker-runner.mjs", "validate"]',
  publish: '["node", "book-analysis-stage-worker-runner.mjs", "publish"]'
}

test('canonical v3 analysis deploys every stage by default as an independently scalable service', () => {
  assert.doesNotMatch(compose, /profiles: \["book-analysis-shadow"\]/)
  for (const [stage, command] of Object.entries(stages)) {
    const service = `  book-analysis-${stage}:\n`
    assert.ok(compose.includes(service), `missing ${stage} service`)
    assert.ok(compose.includes(`    command: ${command}`), `wrong ${stage} command`)
  }
})

test('scan stage has parallel workers by default for catalog backfills', () => {
  const scan = compose.slice(
    compose.indexOf('  book-analysis-scan:'),
    compose.indexOf('  book-analysis-resolve:')
  )
  assert.match(scan, /replicas: \$\{BOOK_ANALYSIS_SCAN_REPLICAS:-8\}/)
})

test('gateway LLM capacity is aligned with the larger scan pool', () => {
  assert.match(envExample, /^LLM_CONCURRENCY=12$/m)
  assert.match(gatewaySource, /envInt\('LLM_CONCURRENCY', 12, 100\)/)
})

test('markup and synthesis capacity survives a routine compose redeploy', () => {
  const markup = compose.slice(
    compose.indexOf('  book-markup-worker:'),
    compose.indexOf('  book-analysis-prepare:')
  )
  const synthesize = compose.slice(
    compose.indexOf('  book-analysis-synthesize:'),
    compose.indexOf('  book-analysis-validate:')
  )
  assert.match(markup, /replicas: \$\{BOOK_MARKUP_WORKER_REPLICAS:-4\}/)
  assert.match(synthesize, /replicas: \$\{BOOK_ANALYSIS_SYNTHESIZE_REPLICAS:-4\}/)
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
  assert.match(resolve, /book-analysis-generator-environment/)
  assert.doesNotMatch(resolve, /book-analysis-storage-environment/)
  assert.match(publish, /book-analysis-database-environment/)
  assert.doesNotMatch(publish, /generator-environment|storage-environment/)
})
