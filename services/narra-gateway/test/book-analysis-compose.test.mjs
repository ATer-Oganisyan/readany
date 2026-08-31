import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const compose = await readFile(new URL('../compose.i167.yml', import.meta.url), 'utf8')
const localCompose = await readFile(
  new URL('../compose.book-analysis-local.yml', import.meta.url),
  'utf8'
)
const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8')
const gatewaySource = await readFile(new URL('../index.mjs', import.meta.url), 'utf8')
const deploySource = await readFile(new URL('../deploy-i167.sh', import.meta.url), 'utf8')
const stagingDeploySource = await readFile(
  new URL('../deploy-staging-fun1.sh', import.meta.url),
  'utf8'
)
const stagingEnvSource = await readFile(
  new URL('../prepare-staging-env-fun1.sh', import.meta.url),
  'utf8'
)

const stages = {
  prepare: '["node", "book-analysis-worker.mjs"]',
  scan: '["node", "book-analysis-scan-worker-runner.mjs"]',
  resolve: '["node", "book-analysis-resolve-worker-runner.mjs"]',
  synthesize: '["node", "book-analysis-stage-worker-runner.mjs", "synthesize"]',
  validate: '["node", "book-analysis-stage-worker-runner.mjs", "validate"]',
  publish: '["node", "book-analysis-stage-worker-runner.mjs", "publish"]'
}

test('canonical v3 analysis deploys every stage in the explicit book-backend profile', () => {
  assert.doesNotMatch(compose, /profiles: \["book-analysis-shadow"\]/)
  for (const [stage, command] of Object.entries(stages)) {
    const service = `  book-analysis-${stage}:\n`
    assert.ok(compose.includes(service), `missing ${stage} service`)
    assert.ok(compose.includes(`    command: ${command}`), `wrong ${stage} command`)
    const section = compose.slice(compose.indexOf(service), compose.indexOf(service) + 500)
    assert.match(section, /profiles: \["book-backend"\]/)
  }
})

test('scan stage starts with one canary worker and can be scaled explicitly', () => {
  const scan = compose.slice(
    compose.indexOf('  book-analysis-scan:'),
    compose.indexOf('  book-analysis-resolve:')
  )
  assert.match(scan, /replicas: \$\{BOOK_ANALYSIS_SCAN_REPLICAS:-1\}/)
})

test('external research services are isolated in the local-only compose profile', () => {
  assert.match(localCompose, /^name: \$\{NARRA_BOOK_ANALYSIS_PROJECT:-narra-book-analysis-local\}$/m)
  const adapter = localCompose.slice(
    localCompose.indexOf('  autiobook-adapter:'),
    localCompose.indexOf('  book-analysis-external:')
  )
  const worker = localCompose.slice(
    localCompose.indexOf('  book-analysis-external:'),
    localCompose.indexOf('  book-analysis-resolve:')
  )
  assert.match(adapter, /profiles: \["book-analysis-external"\]/)
  assert.match(adapter, /read_only: true/)
  assert.doesNotMatch(adapter, /\n    ports:/)
  assert.match(worker, /book-analysis-external-worker-runner\.mjs/)
  assert.match(worker, /AUTIOBOOK_ADAPTER_BASE_URL: http:\/\/autiobook-adapter\.railway\.internal:8080/)
  assert.match(gatewaySource, /BOOK_ANALYSIS_PIPELINE/)
})

test('gateway LLM capacity is aligned with the larger scan pool', () => {
  assert.match(envExample, /^LLM_CONCURRENCY=12$/m)
  assert.match(gatewaySource, /envInt\('LLM_CONCURRENCY', 12, 100\)/)
})

test('markup and synthesis start as one-replica canaries and remain explicitly scalable', () => {
  const markup = compose.slice(
    compose.indexOf('  book-markup-worker:'),
    compose.indexOf('  book-analysis-prepare:')
  )
  const synthesize = compose.slice(
    compose.indexOf('  book-analysis-synthesize:'),
    compose.indexOf('  book-analysis-validate:')
  )
  assert.match(markup, /replicas: \$\{BOOK_MARKUP_WORKER_REPLICAS:-1\}/)
  assert.match(synthesize, /replicas: \$\{BOOK_ANALYSIS_SYNTHESIZE_REPLICAS:-1\}/)
})

test('book display identity has one separate durable worker', () => {
  const identity = compose.slice(
    compose.indexOf('  book-identity-worker:'),
    compose.indexOf('  book-analysis-prepare:')
  )
  assert.match(identity, /command: \["node", "book-identity-worker\.mjs"\]/)
  assert.match(identity, /replicas: \$\{BOOK_IDENTITY_WORKER_REPLICAS:-1\}/)
  assert.match(identity, /read_only: true/)
  assert.match(stagingDeploySource, /--scale book-identity-worker=1/)
})

test('TTS markup runs as an independently scalable hardened container', () => {
  const worker = compose.slice(
    compose.indexOf('  book-tts-markup-worker:'),
    compose.indexOf('  book-analysis-prepare:')
  )
  assert.match(worker, /command: \["node", "book-tts-markup-worker-runner\.mjs"\]/)
  assert.match(worker, /profiles: \["tts-markup"\]/)
  assert.match(worker, /replicas: \$\{BOOK_TTS_MARKUP_WORKER_REPLICAS:-1\}/)
  assert.match(worker, /read_only: true/)
  assert.match(worker, /book-analysis-database-environment/)
  assert.match(worker, /book-analysis-storage-environment/)
  assert.match(worker, /book-analysis-generator-environment/)
  assert.match(envExample, /^BOOK_TTS_MARKUP_WORKER_REPLICAS=1$/m)
  assert.match(stagingDeploySource, /--scale book-tts-markup-worker=1/)
  const publicBooksRouter = gatewaySource.slice(
    gatewaySource.indexOf("app.use('/v2/books'"),
    gatewaySource.indexOf("app.post('/v2/events/batch'")
  )
  assert.match(publicBooksRouter, /ttsMarkupRepository: bookTtsMarkupRepository/)
})

test('book scenes use the configured image route and landscape aspect ratio', () => {
  assert.match(gatewaySource, /generateScene: generateInternalScene/)
  assert.match(gatewaySource, /aspectRatio: '4:3'/)
})

test('shadow analysis workers keep the hardened read-only runtime', () => {
  assert.match(compose, /x-book-analysis-worker: &book-analysis-worker/)
  assert.match(compose, /restart: unless-stopped/)
  assert.match(compose, /read_only: true/)
  assert.match(compose, /no-new-privileges:true/)
  assert.match(compose, /test: \["CMD", "node", "worker-healthcheck\.mjs"\]/)
})

test('media, scenes, TTS and operator campaigns are isolated profiles', () => {
  const media = compose.slice(
    compose.indexOf('  book-media-worker:'),
    compose.indexOf('  book-scene-worker:')
  )
  const scenes = compose.slice(
    compose.indexOf('  book-scene-worker:'),
    compose.indexOf('  generation-queue-operator:')
  )
  const operator = compose.slice(
    compose.indexOf('  generation-queue-operator:'),
    compose.indexOf('\nvolumes:')
  )
  assert.match(media, /profiles: \["media"\]/)
  assert.match(media, /BOOK_MARKUP_WORKER_JOB_TYPES: character_bundle,character_portrait,character_audio,character_animation/)
  assert.match(scenes, /profiles: \["scenes"\]/)
  assert.match(scenes, /BOOK_MARKUP_WORKER_JOB_TYPES: scene_image/)
  assert.match(operator, /profiles: \["operator-campaigns"\]/)
  assert.match(operator, /restart: "no"/)
  assert.doesNotMatch(operator, /healthcheck:/)
})

test('deploy is pinned to fun1, versioned Compose, backups and one-replica canaries', () => {
  assert.match(deploySource, /deploy-staging-fun1\.sh/)
  assert.match(stagingDeploySource, /REMOTE="\$\{REMOTE:-fun1\}"/)
  assert.match(stagingDeploySource, /\[ "\$REMOTE" != "fun1" \]/)
  assert.match(stagingDeploySource, /profiles=\(--profile book-backend --profile media --profile scenes --profile tts-markup\)/)
  assert.match(stagingDeploySource, /-f "\$REMOTE_STAGE\/compose\.i167\.yml"/)
  assert.match(stagingDeploySource, /pg_dump/)
  assert.match(stagingDeploySource, /gateway-data\.tar\.gz/)
  assert.match(stagingDeploySource, /minio-inventory-summary/)
  assert.match(stagingDeploySource, /-e DATABASE_URL=/)
  assert.match(stagingDeploySource, /-e BOOK_BACKEND_REQUIRED=false/)
  assert.match(stagingDeploySource, /--scale book-analysis-scan=1/)
  assert.match(stagingDeploySource, /RestartCount/)
  assert.match(stagingDeploySource, /State\.Health/)
  assert.match(stagingEnvSource, /INSTALLATION_OPERATOR_TOKEN/)
  assert.match(stagingEnvSource, /ANALYTICS_ENV=staging/)
  assert.match(stagingEnvSource, /compose\.env\.\$timestamp/)
})

test('stage services receive only the provider credentials they need', () => {
  const resolve = compose.slice(
    compose.indexOf('  book-analysis-resolve:'),
    compose.indexOf('  book-analysis-synthesize:')
  )
  const publish = compose.slice(
    compose.indexOf('  book-analysis-publish:'),
    compose.indexOf('  book-media-worker:')
  )
  assert.match(resolve, /book-analysis-database-environment/)
  assert.match(resolve, /book-analysis-generator-environment/)
  assert.doesNotMatch(resolve, /book-analysis-storage-environment/)
  assert.match(publish, /book-analysis-database-environment/)
  assert.doesNotMatch(publish, /generator-environment|storage-environment/)
})
