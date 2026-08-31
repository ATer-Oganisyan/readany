import { generationCostReport } from './generation-cost-ledger.mjs'
import { createPostgresPoolFromEnv } from './postgres-runtime.mjs'

function argumentsFrom(argv) {
  const options = { bookEditionIds: [], from: null, to: null }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--book-edition-id' && value) options.bookEditionIds.push(value)
    else if (flag === '--from' && value) options.from = value
    else if (flag === '--to' && value) options.to = value
    else throw new Error(`unknown or incomplete argument: ${flag}`)
    index += 1
  }
  return options
}

const pool = await createPostgresPoolFromEnv(process.env)
try {
  const report = await generationCostReport(pool, argumentsFrom(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
  await pool.end()
}
