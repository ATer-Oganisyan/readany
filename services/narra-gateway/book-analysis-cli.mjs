const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const BOOK_ANALYSIS_CLI_USAGE = `Usage:
  npm run book-analysis -- start --book-edition-id <uuid> [--priority <number>]
  npm run book-analysis -- status --run-id <uuid>
  npm run book-analysis -- result --run-id <uuid>`

function cliError(code, message) {
  return Object.assign(new Error(message), { code })
}

function requireUuid(value, option) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw cliError('INVALID_ARGUMENT', `${option} must be a UUID`)
  }
  return value.toLowerCase()
}

function parsePriority(value) {
  const priority = Number(value)
  if (!Number.isSafeInteger(priority) || priority < -1_000 || priority > 1_000) {
    throw cliError('INVALID_ARGUMENT', '--priority must be an integer between -1000 and 1000')
  }
  return priority
}

export function parseBookAnalysisCommand(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw cliError('USAGE', BOOK_ANALYSIS_CLI_USAGE)
  }
  const command = argv[0]
  if (!['start', 'status', 'result'].includes(command)) {
    throw cliError('USAGE', BOOK_ANALYSIS_CLI_USAGE)
  }
  const options = {}
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw cliError('USAGE', BOOK_ANALYSIS_CLI_USAGE)
    }
    if (Object.hasOwn(options, name)) {
      throw cliError('INVALID_ARGUMENT', `${name} must be specified once`)
    }
    options[name] = value
  }

  if (command === 'start') {
    const allowed = new Set(['--book-edition-id', '--priority'])
    const unknown = Object.keys(options).find((name) => !allowed.has(name))
    if (unknown) throw cliError('INVALID_ARGUMENT', `unsupported option: ${unknown}`)
    return {
      command,
      bookEditionId: requireUuid(options['--book-edition-id'], '--book-edition-id'),
      priority: options['--priority'] === undefined ? 50 : parsePriority(options['--priority'])
    }
  }

  const unknown = Object.keys(options).find((name) => name !== '--run-id')
  if (unknown) throw cliError('INVALID_ARGUMENT', `unsupported option: ${unknown}`)
  return {
    command,
    runId: requireUuid(options['--run-id'], '--run-id')
  }
}

function requireRepository(repository) {
  const methods = [
    'getReadyAnalysisSource',
    'ensureAnalysisRun',
    'getAnalysisRunDetails',
    'getShadowAnalysisPublication'
  ]
  if (!repository || methods.some((method) => typeof repository[method] !== 'function')) {
    throw new TypeError('book analysis operator repository is required')
  }
}

export async function executeBookAnalysisCommand({ argv, repository }) {
  requireRepository(repository)
  const input = parseBookAnalysisCommand(argv)

  if (input.command === 'start') {
    const source = await repository.getReadyAnalysisSource(input.bookEditionId)
    if (!source) {
      throw cliError(
        'BOOK_ANALYSIS_SOURCE_UNAVAILABLE',
        'book edition or verified stored source is unavailable'
      )
    }
    const started = await repository.ensureAnalysisRun({
      bookEditionId: source.id,
      inputHash: source.contentSha256,
      priority: input.priority
    })
    return {
      ok: true,
      command: 'start',
      created: started.created,
      run: started.run,
      prepareJobId: started.prepareJob.id,
      book: {
        id: source.id,
        scope: source.scope,
        catalogKey: source.catalogKey,
        title: source.title,
        author: source.author,
        contentSha256: source.contentSha256
      }
    }
  }

  const details = await repository.getAnalysisRunDetails(input.runId)
  if (!details) throw cliError('BOOK_ANALYSIS_RUN_NOT_FOUND', 'analysis run was not found')
  if (input.command === 'status') {
    return { ok: true, command: 'status', ...details }
  }

  const publication = await repository.getShadowAnalysisPublication(input.runId)
  if (!publication) {
    throw cliError(
      'BOOK_ANALYSIS_RESULT_NOT_READY',
      `shadow result is not ready; run status is ${details.run.status} at ${details.run.stage}`
    )
  }
  return {
    ok: true,
    command: 'result',
    run: details.run,
    book: details.book,
    publication
  }
}
