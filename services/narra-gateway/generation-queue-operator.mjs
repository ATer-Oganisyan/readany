import { parseGenerationQueueCommand } from './generation-queue-control.mjs'
import { createGenerationQueueOperatorRepository } from './generation-queue-operator-repository.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'

let pool
try {
  const command = parseGenerationQueueCommand(process.argv.slice(2))
  pool = await createPostgresPoolFromEnv(process.env)
  await runBookMarkupMigrations(pool)
  const repository = createGenerationQueueOperatorRepository(pool)
  let result
  if (command.command === 'status') result = { operations: await repository.status() }
  else if (command.command === 'pause') {
    result = command.execute
      ? await repository.pause(command)
      : await repository.planPause(command)
  } else {
    result = command.execute
      ? await repository.resume(command)
      : await repository.planResume(command)
  }
  console.log(JSON.stringify({ ok: true, dryRun: command.execute === false, ...result }, null, 2))
} catch (error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code)
    ? error.code
    : 'GENERATION_QUEUE_OPERATOR_FAILED'
  console.error(JSON.stringify({ ok: false, error: { code } }, null, 2))
  process.exitCode = 1
} finally {
  await pool?.end().catch(() => {})
}
