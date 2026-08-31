import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  BOOK_ANALYSIS_PIPELINE_VERSION,
  BOOK_ANALYSIS_SYNTHESIS_VERSION
} from './book-analysis-contracts.mjs'
import { loadFrozenIdentityInput } from './book-analysis-identity-replay.mjs'
import { resolveBookAnalysisEntities } from './book-analysis-resolver.mjs'
import { selectCharacterSynthesisEvidence } from './book-analysis-synthesis.mjs'
import { createInternalGenerationService } from './internal-generation-service.mjs'
import { createPostgresPoolFromEnv } from './postgres-runtime.mjs'
import {
  loadPersonalityFixture,
  scoreFrozenPersonality
} from './evaluation/score-frozen-personality.mjs'

const SAFE_CONTAINER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const PROVIDER_TIMEOUT_MS = 600_000
const MAX_PROVIDER_OUTPUT_BYTES = 8 * 1024 * 1024
const PROVIDER_RUNNER = String.raw`
let body = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { body += chunk })
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(body)
    const baseUrl = String(process.env.LLM_BASE_URL || '').replace(/\/+$/, '')
    const apiKey = String(process.env.LLM_API_KEY || '')
    const model = String(process.env.LLM_MODEL || '')
    if (!baseUrl || !apiKey || !model) throw new Error('configured LLM route is incomplete')
    const response = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: input.messages, max_tokens: 5000 }),
      signal: AbortSignal.timeout(570000)
    })
    if (!response.ok) throw new Error('provider returned HTTP ' + response.status)
    const payload = await response.json()
    const content = payload && payload.choices && payload.choices[0] &&
      payload.choices[0].message && payload.choices[0].message.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('provider returned no content')
    process.stdout.write(JSON.stringify({ content, usage: payload.usage || null }))
  } catch (error) {
    process.stderr.write(String(error && error.message || 'provider call failed'))
    process.exitCode = 1
  }
})
`

function replayError(code, message) {
  return Object.assign(new Error(message), { code })
}

function normalized(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function memoryStorage() {
  const values = new Map()
  return {
    async getBytes({ objectKey }) {
      if (!values.has(objectKey)) throw Object.assign(new Error('not found'), { name: 'NoSuchKey' })
      return { bytes: values.get(objectKey) }
    },
    async putBytes({ objectKey, bytes }) {
      values.set(objectKey, Buffer.from(bytes))
      return { objectKey }
    }
  }
}

function runConfiguredContainerChat(container, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'node', '-e', PROVIDER_RUNNER], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    let outputBytes = 0
    const timer = setTimeout(() => child.kill('SIGTERM'), PROVIDER_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.byteLength
      if (outputBytes > MAX_PROVIDER_OUTPUT_BYTES) child.kill('SIGTERM')
      else stdout.push(chunk)
    })
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(replayError(
          'PROFILE_PROVIDER_FAILED',
          Buffer.concat(stderr).toString('utf8').trim().slice(0, 240) || `provider exited ${code}`
        ))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')).content)
      } catch {
        reject(replayError('PROFILE_PROVIDER_INVALID', 'provider bridge returned invalid JSON'))
      }
    })
    child.stdin.end(JSON.stringify({ messages }))
  })
}

function characterSurfaces(entity) {
  return [entity.canonicalName, ...(entity.aliases ?? [])].map(normalized).filter(Boolean)
}

export function buildFrozenProfileRequests({ input, entities, fixture }) {
  const observationsById = new Map(input.observations.map((item) => [item.id, item]))
  const requests = []
  const unmatched = []
  const ambiguous = []
  for (const gold of fixture.characters) {
    const goldNames = new Set(gold.aliases.map(normalized))
    const matches = entities.filter((entity) =>
      entity.entityKind === 'character' && entity.resolutionStatus === 'confirmed' &&
      characterSurfaces(entity).some((surface) => goldNames.has(surface))
    )
    if (matches.length === 0) {
      unmatched.push({ id: gold.id, name: gold.name })
      continue
    }
    if (matches.length > 1) {
      ambiguous.push({
        id: gold.id,
        name: gold.name,
        entities: matches.map(({ entityKey, canonicalName }) => ({ entityKey, canonicalName }))
      })
      continue
    }
    const entity = matches[0]
    const selectedEvidence = selectCharacterSynthesisEvidence(
      entity.evidenceIds.map((id) => observationsById.get(id)).filter(Boolean)
    ).map((observation) => ({
      id: observation.id,
      type: observation.type,
      fact: observation.fact,
      quote: observation.evidence.quote,
      startOffset: observation.evidence.startOffset,
      endOffset: observation.evidence.endOffset,
      confidence: observation.confidence
    }))
    requests.push({
      goldCharacterId: gold.id,
      request: {
        runId: input.runId,
        snapshotId: input.snapshotId,
        synthesisVersion: BOOK_ANALYSIS_SYNTHESIS_VERSION,
        bookTitle: input.title,
        bookAuthor: input.author,
        textLength: input.textLength,
        entity: {
          entityKey: entity.entityKey,
          entityKind: entity.entityKind,
          canonicalName: entity.canonicalName,
          aliases: entity.aliases.slice(0, 16),
          resolutionStatus: entity.resolutionStatus,
          confidence: entity.confidence,
          evidenceIds: selectedEvidence.map(({ id }) => id),
          data: {
            observationCount: entity.data.observationCount,
            firstEvidenceStartOffset: entity.data.firstEvidenceStartOffset,
            lastEvidenceEndOffset: entity.data.lastEvidenceEndOffset
          }
        },
        evidence: selectedEvidence
      }
    })
  }
  return { requests, unmatched, ambiguous }
}

export function prepareFrozenProfileReplay({ input, fixture }) {
  const entities = resolveBookAnalysisEntities({ observations: input.observations })
  const population = buildFrozenProfileRequests({ input, entities, fixture })
  if (population.unmatched.length || population.ambiguous.length) {
    throw replayError(
      'PROFILE_EVALUATION_POPULATION_INVALID',
      `frozen population has ${population.unmatched.length} unmatched and ${population.ambiguous.length} ambiguous characters`
    )
  }
  return {
    schemaVersion: 1,
    run: { id: input.runId, title: input.title, author: input.author },
    frozenInput: {
      snapshotId: input.snapshotId,
      observationSetHash: input.observationSetHash,
      observationCount: input.observations.length
    },
    engine: {
      pipelineVersion: BOOK_ANALYSIS_PIPELINE_VERSION,
      synthesisVersion: BOOK_ANALYSIS_SYNTHESIS_VERSION
    },
    requests: population.requests
  }
}

function profileRow(request, profile) {
  const firstAppearanceTextOffset = request.entity.data.firstEvidenceStartOffset
  return {
    characterKey: request.entity.entityKey,
    name: request.entity.canonicalName,
    fullName: request.entity.canonicalName,
    aliases: request.entity.aliases,
    identityEvidenceIds: request.entity.evidenceIds,
    firstAppearanceTextOffset,
    warmupTextOffset: Math.max(
      0,
      firstAppearanceTextOffset - Math.max(2_000, Math.ceil(request.textLength * 0.02))
    ),
    ...profile
  }
}

export async function replayPreparedProfiles({ prepared, fixture, providerContainer, onProgress = () => {} }) {
  if (!SAFE_CONTAINER.test(providerContainer)) {
    throw replayError('INVALID_ARGUMENT', 'provider container name is invalid')
  }
  if (!prepared || prepared.schemaVersion !== 1 || !Array.isArray(prepared.requests)) {
    throw replayError('PROFILE_PREPARED_INPUT_INVALID', 'prepared profile replay input is invalid')
  }
  const service = createInternalGenerationService({
    storage: memoryStorage(),
    logger: { info() {}, error() {} },
    completeChat: ({ messages }) => runConfiguredContainerChat(providerContainer, messages),
    async generatePortrait() { throw new Error('portrait generation is disabled in profile replay') },
    async synthesizeSpeech() { throw new Error('speech synthesis is disabled in profile replay') },
    async generateIdleAnimation() { throw new Error('animation generation is disabled in profile replay') }
  })
  const profiles = []
  for (const [index, item] of prepared.requests.entries()) {
    onProgress({ index: index + 1, total: prepared.requests.length, name: item.request.entity.canonicalName })
    const generated = await service.synthesizeCharacterProfile({
      idempotencyKey: [
        item.request.runId,
        'synthesize',
        item.request.snapshotId,
        item.request.entity.entityKey,
        item.request.synthesisVersion
      ].join(':'),
      ...item.request
    })
    profiles.push(profileRow(item.request, generated.profile))
  }
  const score = scoreFrozenPersonality({ fixture, input: { characters: profiles } })
  return {
    schemaVersion: 1,
    run: prepared.run,
    frozenInput: prepared.frozenInput,
    engine: {
      ...prepared.engine,
      providerBridge: providerContainer
    },
    profiles,
    score
  }
}

export async function replayFrozenProfiles({ input, fixture, providerContainer, onProgress = () => {} }) {
  return replayPreparedProfiles({
    prepared: prepareFrozenProfileReplay({ input, fixture }),
    fixture,
    providerContainer,
    onProgress
  })
}

function parseArgs(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true }
  const values = {}
  let requirePass = false
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--require-pass') { requirePass = true; continue }
    if (![
      '--run-id', '--expected-observation-set-hash', '--fixture', '--provider-container', '--output',
      '--prepare-output', '--prepared-input'
    ].includes(name) || !argv[index + 1]) {
      throw replayError('INVALID_ARGUMENT', `unsupported or incomplete option: ${name || '(empty)'}`)
    }
    values[name] = argv[++index]
  }
  const prepareOnly = Boolean(values['--prepare-output'])
  const preparedInput = values['--prepared-input'] || null
  if (prepareOnly && preparedInput) {
    throw replayError('INVALID_ARGUMENT', '--prepare-output and --prepared-input are mutually exclusive')
  }
  if (prepareOnly) {
    for (const required of ['--run-id', '--expected-observation-set-hash']) {
      if (!values[required]) throw replayError('INVALID_ARGUMENT', `${required} is required`)
    }
  } else if (preparedInput) {
    for (const required of ['--provider-container', '--output']) {
      if (!values[required]) throw replayError('INVALID_ARGUMENT', `${required} is required`)
    }
  } else {
    for (const required of ['--run-id', '--expected-observation-set-hash', '--provider-container', '--output']) {
      if (!values[required]) throw replayError('INVALID_ARGUMENT', `${required} is required`)
    }
  }
  return {
    help: false,
    runId: values['--run-id'],
    expectedObservationSetHash: values['--expected-observation-set-hash'],
    fixturePath: values['--fixture'],
    providerContainer: values['--provider-container'],
    outputPath: values['--output'],
    prepareOutputPath: values['--prepare-output'] || null,
    preparedInputPath: preparedInput,
    requirePass
  }
}

async function runCli(argv, env = process.env) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write('Usage: node book-analysis-profile-replay.mjs (--run-id <uuid> --expected-observation-set-hash <sha256> --prepare-output <json> | --prepared-input <json> --provider-container <name> --output <json>) [--fixture <json>] [--require-pass]\n')
    return
  }
  const fixture = await loadPersonalityFixture(options.fixturePath)
  if (options.prepareOutputPath) {
    const pool = await createPostgresPoolFromEnv(env)
    try {
      const input = await loadFrozenIdentityInput(pool, options)
      const prepared = prepareFrozenProfileReplay({ input, fixture })
      await writeFile(options.prepareOutputPath, `${JSON.stringify(prepared, null, 2)}\n`, { flag: 'wx' })
      process.stdout.write(`${JSON.stringify({
        preparedOutput: options.prepareOutputPath,
        requestCount: prepared.requests.length,
        frozenInput: prepared.frozenInput,
        engine: prepared.engine
      })}\n`)
    } finally {
      await pool.end()
    }
    return
  }
  let pool = null
  try {
    let prepared
    if (options.preparedInputPath) {
      prepared = JSON.parse(await readFile(options.preparedInputPath, 'utf8'))
    } else {
      pool = await createPostgresPoolFromEnv(env)
      const input = await loadFrozenIdentityInput(pool, options)
      prepared = prepareFrozenProfileReplay({ input, fixture })
    }
    const result = await replayPreparedProfiles({
      prepared, fixture, providerContainer: options.providerContainer,
      onProgress({ index, total, name }) { process.stderr.write(`[profile-replay] ${index}/${total} ${name}\n`) }
    })
    await writeFile(options.outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
    process.stdout.write(`${JSON.stringify({
      output: options.outputPath,
      engine: result.engine,
      metrics: result.score.metrics,
      gate: result.score.gate
    })}\n`)
    if (options.requirePass && !result.score.gate.passed) {
      throw replayError('PERSONALITY_QUALITY_GATE_FAILED', 'frozen personality quality gate failed')
    }
  } finally {
    await pool?.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error?.code || 'UNKNOWN',
      message: error?.message || 'profile replay failed'
    })}\n`)
    process.exitCode = 1
  })
}
