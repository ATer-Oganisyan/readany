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
const gatewayConfigSource = await readFile(new URL('../platform/gateway-config.mjs', import.meta.url), 'utf8')
const deploySource = await readFile(new URL('../deploy.sh', import.meta.url), 'utf8')
const remoteDeploySource = await readFile(
  new URL('../deploy-remote.sh', import.meta.url),
  'utf8'
)
const migrateSource = await readFile(new URL('../migrate.sh', import.meta.url), 'utf8')
const deprecatedDeploySource = await readFile(new URL('../deploy-i167.sh', import.meta.url), 'utf8')
const deprecatedStagingDeploySource = await readFile(
  new URL('../deploy-staging-fun1.sh', import.meta.url),
  'utf8'
)
const stagingEnvSource = await readFile(
  new URL('../prepare-staging-env-fun1.sh', import.meta.url),
  'utf8'
)

test('canonical v3 analysis runs as one multi-stage worker in the book-backend profile', () => {
  assert.doesNotMatch(compose, /profiles: \["book-analysis-shadow"\]/)
  const worker = compose.slice(
    compose.indexOf('  book-analysis-worker:'),
    compose.indexOf('  book-analysis-pool:')
  )
  assert.match(worker, /command: \["node", "analysis\/book-analysis-worker\.mjs"\]/)
  assert.match(worker, /profiles: \["book-backend"\]/)
  assert.match(worker, /WORKER_TYPE: book-analysis$/m)
  // Единая очередь book_analysis_jobs: отдельных сервисов на стадию больше нет.
  for (const stage of ['prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish']) {
    assert.ok(!compose.includes(`  book-analysis-${stage}:\n`), `stale ${stage} service`)
  }
  assert.doesNotMatch(compose, /book-analysis-\w+-worker-runner\.mjs/)
})

test('a hot-stage pool stays available as an explicit opt-in profile', () => {
  const pool = compose.slice(
    compose.indexOf('  book-analysis-pool:'),
    compose.indexOf('  book-media-worker:')
  )
  assert.match(pool, /profiles: \["book-analysis-pool"\]/)
  assert.match(pool, /command: \["node", "analysis\/book-analysis-worker\.mjs"\]/)
  assert.match(pool, /BOOK_ANALYSIS_STAGES: \$\{BOOK_ANALYSIS_POOL_STAGES:-scan\}/)
  assert.match(pool, /replicas: \$\{BOOK_ANALYSIS_POOL_REPLICAS:-2\}/)
  assert.match(envExample, /^BOOK_ANALYSIS_POOL_STAGES=scan$/m)
  assert.match(envExample, /^BOOK_ANALYSIS_WORKER_REPLICAS=1$/m)
})

test('ScanPolicy defaults to balanced and reaches prepare, gateway and scan workers', () => {
  assert.match(envExample, /^BOOK_ANALYSIS_SCAN_POLICY_PROFILE=balanced$/m)
  assert.match(
    compose,
    /BOOK_ANALYSIS_SCAN_POLICY_PROFILE: \$\{BOOK_ANALYSIS_SCAN_POLICY_PROFILE:-balanced\}/
  )
  const gateway = compose.slice(
    compose.indexOf('\n  gateway:\n'),
    compose.indexOf('\n  postgres:\n')
  )
  const worker = compose.slice(
    compose.indexOf('  book-analysis-worker:'),
    compose.indexOf('  book-analysis-pool:')
  )
  assert.match(gateway, /<<: \*book-analysis-scan-policy-environment/)
  assert.match(worker, /\*book-analysis-scan-policy-environment/)
  assert.match(localCompose, /BOOK_ANALYSIS_SCAN_POLICY_PROFILE: \$\{BOOK_ANALYSIS_SCAN_POLICY_PROFILE:-balanced\}/)
  assert.match(localCompose, /<<: \[\*database-environment, \*storage-environment, \*generator-environment, \*scan-policy-environment\]/)
  assert.match(gatewaySource, /book_analysis_scan_policy:/)
  assert.match(gatewaySource, /preserve_partial_results: BOOK_ANALYSIS_SCAN_POLICY\.preservePartialResults/)
})

test('external research services are isolated in the local-only compose profile', () => {
  assert.match(localCompose, /^name: \$\{NARRA_BOOK_ANALYSIS_PROJECT:-narra-book-analysis-local\}$/m)
  const adapter = localCompose.slice(
    localCompose.indexOf('  autiobook-adapter:'),
    localCompose.indexOf('  book-analysis-external:')
  )
  const worker = localCompose.slice(
    localCompose.indexOf('  book-analysis-external:'),
    localCompose.indexOf('\nvolumes:')
  )
  assert.match(adapter, /profiles: \["book-analysis-external"\]/)
  assert.match(adapter, /read_only: true/)
  assert.doesNotMatch(adapter, /\n    ports:/)
  assert.match(worker, /command: \["node", "analysis\/book-analysis-worker\.mjs", "external"\]/)
  assert.match(worker, /AUTIOBOOK_ADAPTER_BASE_URL: http:\/\/autiobook-adapter\.railway\.internal:8080/)
  assert.match(gatewaySource, /BOOK_ANALYSIS_PIPELINE/)
})

test('gateway LLM capacity is aligned with the larger scan pool', () => {
  assert.match(envExample, /^LLM_CONCURRENCY=12$/m)
  assert.match(gatewayConfigSource, /envInt\('LLM_CONCURRENCY', 12, 100\)/)
})

test('markup and synthesis start as one-replica canaries and remain explicitly scalable', () => {
  const markup = compose.slice(
    compose.indexOf('  book-markup-worker:'),
    compose.indexOf('  book-analysis-worker:')
  )
  const analysis = compose.slice(
    compose.indexOf('  book-analysis-worker:'),
    compose.indexOf('  book-analysis-pool:')
  )
  assert.match(markup, /replicas: \$\{BOOK_MARKUP_WORKER_REPLICAS:-1\}/)
  assert.match(analysis, /replicas: \$\{BOOK_ANALYSIS_WORKER_REPLICAS:-1\}/)
})

test('book display identity has one separate durable worker', () => {
  const identity = compose.slice(
    compose.indexOf('  book-identity-worker:'),
    compose.indexOf('  book-analysis-worker:')
  )
  assert.match(identity, /command: \["node", "books\/book-identity-worker\.mjs"\]/)
  assert.match(identity, /replicas: \$\{BOOK_IDENTITY_WORKER_REPLICAS:-1\}/)
  assert.match(identity, /read_only: true/)
  assert.match(deploySource, /book_worker_services=\(book-markup-worker book-identity-worker/)
})

test('TTS markup runs as an independently scalable hardened container', () => {
  const worker = compose.slice(
    compose.indexOf('  book-tts-markup-worker:'),
    compose.indexOf('  book-analysis-worker:')
  )
  assert.match(worker, /command: \["node", "tts\/book-tts-markup-worker-runner\.mjs"\]/)
  assert.match(worker, /profiles: \["tts-markup"\]/)
  assert.match(worker, /replicas: \$\{BOOK_TTS_MARKUP_WORKER_REPLICAS:-1\}/)
  assert.match(worker, /read_only: true/)
  assert.match(worker, /book-analysis-database-environment/)
  assert.match(worker, /book-analysis-storage-environment/)
  assert.match(worker, /book-analysis-generator-environment/)
  assert.match(envExample, /^BOOK_TTS_MARKUP_WORKER_REPLICAS=1$/m)
  assert.match(deploySource, /tts_services=\(book-tts-markup-worker\)/)
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

test('Gateway never starts the scene backfill automatically', () => {
  assert.match(gatewaySource, /automatic backfill disabled; on-demand only/)
  assert.doesNotMatch(gatewaySource, /enqueueBookSceneBackfill\(\)/)
})

test('shadow analysis workers keep the hardened read-only runtime', () => {
  assert.match(compose, /x-book-analysis-worker: &book-analysis-worker/)
  assert.match(compose, /restart: unless-stopped/)
  assert.match(compose, /read_only: true/)
  assert.match(compose, /no-new-privileges:true/)
  assert.match(compose, /test: \["CMD", "node", "platform\/worker-healthcheck\.mjs"\]/)
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

test('database migrations are an explicit one-shot Compose operation', () => {
  const migration = compose.slice(
    compose.indexOf('  migrate:'),
    compose.indexOf('  book-markup-worker:')
  )
  assert.match(compose, /DATABASE_AUTO_MIGRATE: "false"/)
  assert.match(migration, /profiles: \["operations"\]/)
  assert.match(migration, /command: \["node", "db\/migrate\.mjs"\]/)
  assert.match(migration, /DATABASE_AUTO_MIGRATE: "true"/)
  assert.match(migration, /restart: "no"/)
})

test('deploy uses Docker Compose only and keeps migrations and backups separate', () => {
  assert.match(deploySource, /mode="default"/)
  assert.match(deploySource, /add_service gateway/)
  assert.match(deploySource, /--force-recreate --wait --wait-timeout/)
  assert.match(deploySource, /up_args\+=\(--no-deps\)/)
  assert.match(deploySource, /--confirm-stateful-restart/)
  assert.match(deploySource, /migrate node db\/migrate\.mjs --check/)
  assert.match(deploySource, /docker compose/)
  assert.doesNotMatch(deploySource, /\bssh\b|\brsync\b|\bsystemctl\b|\bnpm\b/)
  assert.doesNotMatch(deploySource, /\bdocker (?!compose\b)/)
  assert.doesNotMatch(deploySource, /pg_dump|backup-i167/)

  assert.match(migrateSource, /docker compose/)
  assert.match(migrateSource, /run --rm migrate/)
  assert.doesNotMatch(migrateSource, /deploy\.sh|backup-i167|pg_dump/)

  assert.match(remoteDeploySource, /bundle_files=\(/)
  assert.match(remoteDeploySource, /deploy\.sh/)
  assert.match(remoteDeploySource, /migrate\.sh/)
  assert.match(remoteDeploySource, /compose\.i167\.yml/)
  assert.match(remoteDeploySource, /\bssh\b/)
  assert.match(remoteDeploySource, /\bscp\b/)
  assert.match(remoteDeploySource, /sudo bash/)
  assert.match(remoteDeploySource, /DOCKER_CONFIG/)
  assert.doesNotMatch(remoteDeploySource, /Dockerfile|package\.json|index\.mjs/)

  assert.match(deprecatedDeploySource, /DEPRECATED/)
  assert.match(deprecatedDeploySource, /exit 64/)
  assert.match(deprecatedStagingDeploySource, /DEPRECATED/)
  assert.match(deprecatedStagingDeploySource, /exit 64/)
})

test('staging environment preparation preserves existing secrets', () => {
  assert.match(stagingEnvSource, /INSTALLATION_OPERATOR_TOKEN/)
  assert.match(stagingEnvSource, /BOOK_OPERATOR_USERNAME/)
  assert.match(stagingEnvSource, /BOOK_OPERATOR_PASSWORD/)
  assert.match(stagingEnvSource, /ANALYTICS_ENV=staging/)
  assert.match(stagingEnvSource, /runtime_keys=\(/)
  assert.match(stagingEnvSource, /GATEWAY_TOKEN_SECRET/)
  assert.match(stagingEnvSource, /INSTALLATION_SECRET_PEPPER/)
  assert.match(stagingEnvSource, /ANALYTICS_HMAC_SECRET/)
  assert.match(stagingEnvSource, /grep -Fqx -- "\$source_line"/)
  assert.match(stagingEnvSource, /current_managed_keys=\(/)
  assert.match(stagingEnvSource, /printf '%s\\n' "\$operator_token_line"/)
  assert.doesNotMatch(stagingEnvSource, /openssl rand/)
  assert.match(stagingEnvSource, /compose\.env\.\$timestamp/)
})

test('the analysis worker declares every credential its stages need', () => {
  const worker = compose.slice(
    compose.indexOf('  book-analysis-worker:'),
    compose.indexOf('  book-analysis-pool:')
  )
  // Один процесс обслуживает scan (storage + generator) и publish (только БД),
  // поэтому per-stage least privilege сменился явным общим профилем.
  assert.match(worker, /book-analysis-database-environment/)
  assert.match(worker, /book-analysis-storage-environment/)
  assert.match(worker, /book-analysis-generator-environment/)
})

test('deploy maps every analysis worker source file onto the single service', () => {
  assert.match(deploySource, /analysis_services=\(book-analysis-worker\)/)
  assert.match(deploySource, /book-analysis-\*worker\.mjs\)/)
  assert.match(deploySource, /worker-runtime\.mjs\)/)
})

test('deploy declares every profile the compose file uses, so orphan removal is safe', () => {
  // `--remove-orphans` снимает контейнеры сервисов, которых в compose нет, — и
  // ради этого он добавлен: шесть прежних раннеров анализа заменены одним
  // воркером, и на развёрнутой установке их контейнеры иначе продолжали бы
  // забирать задания. Но сироты считаются по **активным** профилям: стоит
  // забыть профиль, и Compose сочтёт чужими его собственные сервисы. На момент
  // добавления так и было — deploy объявлял пять профилей из семи, и под
  // удаление попадали пул анализа и операторский воркер.
  const declared = new Set([...deploySource.matchAll(/--profile\s+([\w-]+)/g)]
    .map(([, profile]) => profile))
  const used = new Set([...compose.matchAll(/profiles:\s*\[([^\]]*)\]/g)]
    .flatMap(([, list]) => list.split(',').map((value) => value.trim().replace(/["']/g, '')))
    .filter(Boolean))

  assert.ok(used.size > 0, 'в compose-файле не найдено ни одного профиля')
  const missing = [...used].filter((profile) => !declared.has(profile)).sort()
  assert.deepEqual(missing, [], `deploy не объявляет профили: ${missing.join(', ')}`)
})

test('deploy removes orphaned containers when it recreates services', () => {
  assert.match(deploySource, /up_args=\(up[^)]*--remove-orphans/)
})
