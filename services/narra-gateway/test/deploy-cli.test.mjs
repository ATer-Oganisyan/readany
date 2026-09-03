import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readlink, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const deployScript = fileURLToPath(new URL('../deploy.sh', import.meta.url))
const remoteDeployScript = fileURLToPath(new URL('../deploy-remote.sh', import.meta.url))
const prepareHostScript = fileURLToPath(new URL('../prepare-deploy-host.sh', import.meta.url))
const migrateScript = fileURLToPath(new URL('../migrate.sh', import.meta.url))
const productionImage = `ghcr.io/mishanaer/narra-gateway:${'a'.repeat(40)}`

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
    '--image', 'ghcr.io/mishanaer/narra-gateway:latest',
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
  assert.match(result.stdout, /ssh -tt .*sudo/)
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

test('host preparation provisions CI access with one remote sudo invocation', () => {
  const result = run(prepareHostScript, [
    '--environment', 'test',
    '--public-key', '/tmp/nonexistent-narra-ci.pub',
    '--transport-dry-run'
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /environment=test host=fun1 deploy-user=narra-deploy/)
  assert.match(result.stdout, /ssh -tt fun1/)
  assert.match(result.stdout, /sudo/)
  assert.match(result.stdout, /useradd/)
  assert.match(result.stdout, /usermod/)
  assert.match(result.stdout, /docker/)
})

test('production host preparation requires an explicit SSH host', () => {
  const result = spawnSync('bash', [prepareHostScript,
    '--environment', 'prod',
    '--public-key', '/tmp/nonexistent-narra-ci.pub',
    '--transport-dry-run'
  ], {
    encoding: 'utf8',
    env: { ...process.env, NARRA_PROD_SSH_HOST: '' }
  })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--host or NARRA_PROD_SSH_HOST is required/)
})

test('host preparation creates the deploy account through one sudo call', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'narra-prepare-host-test-'))
  const binDir = join(sandbox, 'bin')
  const remoteRoot = join(sandbox, 'remote')
  const deployHome = join(sandbox, 'deploy-home')
  const envFile = join(remoteRoot, 'compose.env')
  const publicKeyFile = join(sandbox, 'narra-ci.pub')
  const sudoLog = join(sandbox, 'sudo.log')
  const userState = join(sandbox, 'user-created')
  const bashEnv = join(sandbox, 'bash-env')
  await mkdir(binDir)
  await mkdir(remoteRoot)
  await writeFile(envFile, 'NARRA_POSTGRES_PASSWORD=test\n')
  await writeFile(publicKeyFile, 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest narra-ci\n')

  const mocks = {
    ssh: `#!/usr/bin/env bash
set -euo pipefail
while [ "$#" -gt 0 ]; do
  case "$1" in
    -tt) shift ;;
    -p|-i) shift 2 ;;
    *) break ;;
  esac
done
shift
exec bash -c "$*"
`,
    sudo: `#!/usr/bin/env bash
set -euo pipefail
printf 'sudo\n' >> "$SUDO_LOG"
exec "$@"
`,
    docker: `#!/usr/bin/env bash
set -euo pipefail
[ "$1" = compose ] && [ "$2" = version ]
`,
    useradd: `#!/usr/bin/env bash
set -euo pipefail
touch "$USER_STATE"
`,
    usermod: `#!/usr/bin/env bash
set -euo pipefail
[ "$1" = -aG ] && [ "$2" = docker ] && [ "$3" = narra-deploy ]
`,
    id: `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = -gn ]; then
  echo narra-deploy
elif [ -f "$USER_STATE" ]; then
  exit 0
else
  exit 1
fi
`,
    getent: `#!/usr/bin/env bash
set -euo pipefail
case "$1:$2" in
  group:docker) echo 'docker:x:999:' ;;
  passwd:narra-deploy) echo "narra-deploy:x:1001:1001::${deployHome}:/bin/bash" ;;
  *) exit 1 ;;
esac
`,
    install: `#!/usr/bin/env bash
set -euo pipefail
args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-g) shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
exec /usr/bin/install "\${args[@]}"
`,
    chown: `#!/usr/bin/env bash
exit 0
`
  }
  for (const [name, source] of Object.entries(mocks)) {
    const path = join(binDir, name)
    await writeFile(path, source)
    await chmod(path, 0o755)
  }
  await writeFile(bashEnv, `export PATH="${binDir}:$PATH"\n`)

  try {
    const result = spawnSync('bash', [prepareHostScript,
      '--environment', 'test',
      '--host', 'fake-host',
      '--remote-root', remoteRoot,
      '--env-file', envFile,
      '--public-key', publicKeyFile
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BASH_ENV: bashEnv,
        PATH: `${binDir}:${process.env.PATH}`,
        SUDO_LOG: sudoLog,
        USER_STATE: userState
      }
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(await readFile(sudoLog, 'utf8'), 'sudo\n')
    assert.equal(
      await readFile(join(deployHome, '.ssh', 'authorized_keys'), 'utf8'),
      'restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest narra-ci\n'
    )
    assert.deepEqual((await readdir(remoteRoot)).sort(), ['compose.env', 'releases'])
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
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
  const sudoMock = join(binDir, 'sudo')
  const sudoLog = join(sandbox, 'sudo.log')
  const bashEnv = join(sandbox, 'bash-env')
  await writeFile(sshMock, `#!/usr/bin/env bash
set -euo pipefail
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-p|-i) shift 2 ;;
    -t|-tt) shift ;;
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
  await writeFile(sudoMock, `#!/usr/bin/env bash
set -euo pipefail
printf 'sudo\n' >> "$SUDO_LOG"
exec "$@"
`)
  await writeFile(bashEnv, `export PATH="${binDir}:$PATH"\n`)
  await chmod(sshMock, 0o755)
  await chmod(scpMock, 0o755)
  await chmod(flockMock, 0o755)
  await chmod(mvMock, 0o755)
  await chmod(sudoMock, 0o755)

  const releasesDir = join(remoteRoot, 'releases')
  await mkdir(releasesDir, { recursive: true })
  for (let index = 1; index <= 4; index += 1) {
    const oldRelease = join(releasesDir, `old-${index}`)
    await mkdir(oldRelease)
    await writeFile(join(oldRelease, 'deploy.sh'), `old deploy ${index}`)
    await writeFile(join(oldRelease, 'migrate.sh'), `old migrate ${index}`)
    await writeFile(join(oldRelease, 'compose.i167.yml'), `old compose ${index}`)
    await utimes(oldRelease, 1_000 + index, 1_000 + index)
  }

  try {
    const result = spawnSync('bash', [remoteDeployScript,
      '--environment', 'test',
      '--host', 'fake-host',
      '--remote-root', remoteRoot,
      '--bundle-version', 'test-bundle',
      '--keep-releases', '3',
      '--component', 'gateway',
      '--dry-run'
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BASH_ENV: bashEnv,
        PATH: `${binDir}:${process.env.PATH}`,
        SUDO_LOG: sudoLog
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
    assert.equal((await readdir(releasesDir)).length, 3, result.stdout)
    assert.match(result.stdout, /environment=test mode=selected/)
    assert.match(result.stdout, /services= gateway/)
    assert.match(result.stdout, /pruned release=/)
    assert.equal(await readFile(sudoLog, 'utf8'), 'sudo\n')
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})
