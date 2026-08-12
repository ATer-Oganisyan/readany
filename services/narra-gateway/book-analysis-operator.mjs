import {
  executeBookAnalysisCommand,
  parseBookAnalysisCommand
} from './book-analysis-cli.mjs'
import { createPostgresBookAnalysisRepository } from './book-analysis-repository.mjs'
import { createPostgresPoolFromEnv, runBookMarkupMigrations } from './postgres-runtime.mjs'

let pool
try {
  parseBookAnalysisCommand(process.argv.slice(2))
  pool = await createPostgresPoolFromEnv(process.env)
  await runBookMarkupMigrations(pool)
  const result = await executeBookAnalysisCommand({
    argv: process.argv.slice(2),
    repository: createPostgresBookAnalysisRepository(pool)
  })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code)
    ? error.code
    : 'BOOK_ANALYSIS_OPERATOR_FAILED'
  const knownMessage = [
    'USAGE',
    'INVALID_ARGUMENT',
    'BOOK_ANALYSIS_SOURCE_UNAVAILABLE',
    'BOOK_ANALYSIS_RUN_NOT_FOUND',
    'BOOK_ANALYSIS_RESULT_NOT_READY'
  ].includes(code)
  console.error(JSON.stringify({
    ok: false,
    error: {
      code,
      message: knownMessage ? error.message : 'book analysis operator command failed'
    }
  }, null, 2))
  process.exitCode = 1
} finally {
  await pool?.end().catch(() => {})
}
