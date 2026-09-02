import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const deployScript = fileURLToPath(new URL('../deploy.sh', import.meta.url))
const migrateScript = fileURLToPath(new URL('../migrate.sh', import.meta.url))
const productionImage = `readany/narra-gateway:${'a'.repeat(40)}`

function run(script, args) {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8' })
}

test('backend deploy requires an explicit environment', () => {
  const result = run(deployScript, ['--dry-run'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--environment is required/)
})

test('default test deploy recreates only gateway', () => {
  const result = run(deployScript, ['--environment', 'test', '--dry-run'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /environment=test mode=default/)
  assert.match(result.stdout, /services= gateway\n/)
  assert.match(result.stdout, /up -d --force-recreate --wait .* --no-deps gateway/)
  assert.doesNotMatch(result.stdout, /book-analysis-prepare/)
  assert.doesNotMatch(result.stdout, /services=.*postgres/)
})

test('selected mode expands worker components without databases', () => {
  const result = run(deployScript, [
    '--environment', 'test',
    '--component', 'analysis-workers',
    '--component', 'scene-workers',
    '--dry-run'
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /mode=selected/)
  assert.match(result.stdout, /book-analysis-prepare/)
  assert.match(result.stdout, /book-analysis-publish/)
  assert.match(result.stdout, /book-scene-worker/)
  assert.doesNotMatch(result.stdout, /services=.*postgres/)
})

test('production rejects mutable image tags', () => {
  const result = run(deployScript, [
    '--environment', 'prod',
    '--image', 'readany/narra-gateway:latest',
    '--dry-run'
  ])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /prod image must use a sha256 digest/)
})

test('full production deploy requires explicit stateful confirmation', () => {
  const rejected = run(deployScript, [
    '--environment', 'prod',
    '--mode', 'full',
    '--image', productionImage,
    '--dry-run'
  ])
  assert.equal(rejected.status, 2)
  assert.match(rejected.stderr, /requires --confirm-stateful-restart/)

  const accepted = run(deployScript, [
    '--environment', 'prod',
    '--mode', 'full',
    '--image', productionImage,
    '--confirm-stateful-restart',
    '--dry-run'
  ])
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.match(accepted.stdout, /services= postgres minio minio-init gateway/)
  const upLine = accepted.stdout.split('\n').find((line) => line.includes(' up -d '))
  assert.ok(upLine)
  assert.doesNotMatch(upLine, /--no-deps/)
})

test('diff mode maps a gateway file to gateway only', () => {
  const result = run(deployScript, [
    '--environment', 'test',
    '--mode', 'diff',
    '--changed-path', 'services/narra-gateway/index.mjs',
    '--dry-run'
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /services= gateway\n/)
  assert.doesNotMatch(result.stdout, /book-analysis-prepare/)
})

test('migration changes conservatively select the complete application runtime', () => {
  const result = run(deployScript, [
    '--environment', 'test',
    '--mode', 'diff',
    '--changed-path', 'services/narra-gateway/migrations/027_example.sql',
    '--dry-run'
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /services= gateway book-markup-worker/)
  assert.match(result.stdout, /book-tts-markup-worker/)
  assert.match(result.stdout, /migrate node migrate\.mjs --check/)
})

test('production migration apply requires a separate confirmation', () => {
  const rejected = run(migrateScript, [
    '--environment', 'prod',
    '--apply',
    '--image', productionImage,
    '--dry-run'
  ])
  assert.equal(rejected.status, 2)
  assert.match(rejected.stderr, /production migration requires --confirm/)

  const accepted = run(migrateScript, [
    '--environment', 'prod',
    '--apply',
    '--confirm',
    '--image', productionImage,
    '--dry-run'
  ])
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.match(accepted.stdout, /run --rm migrate/)
  assert.doesNotMatch(accepted.stdout, /deploy\.sh|backup/)
})
