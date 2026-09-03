import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readlink, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const deployScript = fileURLToPath(new URL('../deploy.sh', import.meta.url))
const remoteDeployScript = fileURLToPath(new URL('../deploy-remote.sh', import.meta.url))
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

test('remote deploy uploads only the fixed deployment bundle', () => {
  const result = run(remoteDeployScript, [
    '--environment', 'test',
    '--bundle-version', 'test-bundle',
    '--transport-dry-run',
    '--component', 'gateway'
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /environment=test operation=deploy host=fun1/)
  assert.match(result.stdout, /files= deploy\.sh migrate\.sh compose\.i167\.yml/)
  assert.match(result.stdout, /scp .*deploy\.sh .*migrate\.sh .*compose\.i167\.yml/s)
  assert.match(result.stdout, /deploy\.sh.*--environment.*test.*--component.*gateway/s)
  assert.doesNotMatch(result.stdout, /Dockerfile|package\.json|index\.mjs|migrate\.mjs/)
  assert.match(result.stdout, /no connection was made/)
})

test('remote deploy maps migration operations to the server migration entrypoint', () => {
  const result = run(remoteDeployScript, [
    '--environment', 'test',
    '--operation', 'migrate-check',
    '--bundle-version', 'test-bundle',
    '--transport-dry-run'
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /operation=migrate-check/)
  assert.match(result.stdout, /migrate\.sh.*--environment.*test.*--check/s)
})

test('remote production deploy requires an explicit SSH host', () => {
  const result = spawnSync('bash', [remoteDeployScript,
    '--environment', 'prod',
    '--bundle-version', 'test-bundle',
    '--transport-dry-run',
    '--image', productionImage
  ], {
    encoding: 'utf8',
    env: { ...process.env, NARRA_PROD_SSH_HOST: '' }
  })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--host or NARRA_PROD_SSH_HOST is required/)
})

test('remote diff accepts changed paths but rejects Git refs', () => {
  const rejected = run(remoteDeployScript, [
    '--environment', 'test',
    '--mode', 'diff',
    '--from', 'HEAD~1',
    '--bundle-version', 'test-bundle',
    '--transport-dry-run'
  ])
  assert.equal(rejected.status, 2)
  assert.match(rejected.stderr, /pass --changed-path from CI/)

  const accepted = run(remoteDeployScript, [
    '--environment', 'test',
    '--mode', 'diff',
    '--changed-path', 'services/narra-gateway/index.mjs',
    '--bundle-version', 'test-bundle',
    '--transport-dry-run'
  ])
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.match(accepted.stdout, /--changed-path.*services\/narra-gateway\/index\.mjs/s)
})

test('remote deploy installs and invokes the bundle through SSH transport', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'narra-deploy-remote-test-'))
  const binDir = join(sandbox, 'bin')
  const remoteRoot = join(sandbox, 'remote')
  await mkdir(binDir)

  const sshMock = join(binDir, 'ssh')
  const scpMock = join(binDir, 'scp')
  const flockMock = join(binDir, 'flock')
  const mvMock = join(binDir, 'mv')
  const bashEnv = join(sandbox, 'bash-env')
  await writeFile(sshMock, `#!/usr/bin/env bash
set -euo pipefail
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-p|-i) shift 2 ;;
    *) break ;;
  esac
done
shift
exec bash -c "$*"
`)
  await writeFile(scpMock, `#!/usr/bin/env bash
set -euo pipefail
files=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-P|-i) shift 2 ;;
    *)
      if [ "$#" -eq 1 ]; then
        destination="$1"
      else
        files+=("$1")
      fi
      shift
      ;;
  esac
done
target="\${destination#*:}"
cp -- "\${files[@]}" "$target/"
`)
  await writeFile(flockMock, `#!/usr/bin/env bash
set -euo pipefail
[ "$1" = -x ]
shift 2
exec "$@"
`)
  await writeFile(mvMock, `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = -Tf ]; then
  shift
  [ "$1" != -- ] || shift
  exec /bin/mv -f "$@"
fi
exec /bin/mv "$@"
`)
  await writeFile(bashEnv, `export PATH="${binDir}:$PATH"\n`)
  await chmod(sshMock, 0o755)
  await chmod(scpMock, 0o755)
  await chmod(flockMock, 0o755)
  await chmod(mvMock, 0o755)

  try {
    const result = spawnSync('bash', [remoteDeployScript,
      '--environment', 'test',
      '--host', 'fake-host',
      '--remote-root', remoteRoot,
      '--bundle-version', 'test-bundle',
      '--component', 'gateway',
      '--dry-run'
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BASH_ENV: bashEnv,
        PATH: `${binDir}:${process.env.PATH}`
      }
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.deepEqual(
      (await readdir(join(remoteRoot, 'releases', 'test-bundle'))).sort(),
      ['compose.i167.yml', 'deploy.sh', 'migrate.sh']
    )
    assert.equal(
      await readlink(join(remoteRoot, 'current')),
      join(remoteRoot, 'releases', 'test-bundle')
    )
    assert.match(result.stdout, /environment=test mode=selected/)
    assert.match(result.stdout, /services= gateway/)
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})
