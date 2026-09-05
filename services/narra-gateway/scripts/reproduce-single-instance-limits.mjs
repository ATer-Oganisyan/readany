// Readiness probe, not a passing capacity test. Exit 2 means horizontal scaling
// is unsafe with the current process-local registry/gates. Uses temporary data.
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createConcurrencyGate } from '../concurrency.mjs'
import { createInstallationRegistry } from '../installation-registry.mjs'

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'narra-replica-readiness-'))
const first = createInstallationRegistry({ dataDir, environment: 'test' })
const second = createInstallationRegistry({ dataDir, environment: 'test' })
try {
  await first.start()
  const installationId = randomUUID()
  await first.register({ installationId, refreshSecretHash: 'a'.repeat(43) })
  await second.start()
  const reservation = { installationId, metric: 'replica_probe', perInstallationLimit: 1, globalLimit: 1 }
  const attempts = await Promise.all([first.reserve(reservation), second.reserve(reservation)])
  await first.revoke(installationId, 'local audit probe')
  const gates = Array.from({ length: 2 }, () => createConcurrencyGate({ limit: 1, queueLimit: 1, name: 'replica-probe' }))
  const releases = await Promise.all(gates.map((gate) => gate.acquire()))
  const report = {
    replicas: 2,
    configuredDailyLimit: 1,
    acceptedReservations: attempts.filter((value) => value.ok).length,
    revokedOnFirst: first.authenticate({ sub: installationId, ver: 1 }) === null,
    stillAuthenticatedOnSecond: second.authenticate({ sub: installationId, ver: 1 }) !== null,
    configuredConcurrencyPerReplica: 1,
    aggregateActive: gates.reduce((sum, gate) => sum + gate.status().active, 0),
    conclusion: 'The current registry and gates support one gateway instance, not shared horizontal enforcement.'
  }
  releases.forEach((release) => release())
  console.log(JSON.stringify(report, null, 2))
  if (report.acceptedReservations > 1 || report.stillAuthenticatedOnSecond) process.exitCode = 2
} finally {
  await first.stop()
  await second.stop()
  await rm(dataDir, { recursive: true, force: true })
}
