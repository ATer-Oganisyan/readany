import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { voiceConfig } from '../voices.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_PERSONALITY_FIXTURE_PATH = path.join(
  directory,
  'personality',
  'pride-prejudice-swcpq-v1.json'
)

function inputError(message) {
  return Object.assign(new TypeError(message), { code: 'PERSONALITY_ACCEPTANCE_INPUT_INVALID' })
}

function normalized(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000
}

function ratio(numerator, denominator) {
  return denominator > 0 ? rounded(numerator / denominator) : 0
}

function metrics(tp, predictionCount, goldCount) {
  const precision = ratio(tp, predictionCount)
  const recall = ratio(tp, goldCount)
  return {
    precision,
    recall,
    f1: precision + recall > 0 ? rounded(2 * precision * recall / (precision + recall)) : 0
  }
}

function uniqueStrings(value, name) {
  if (!Array.isArray(value)) throw inputError(`${name} must be an array`)
  const result = []
  const seen = new Set()
  for (const [index, item] of value.entries()) {
    const display = String(item || '').trim().replace(/\s+/gu, ' ')
    if (!display) throw inputError(`${name}[${index}] must be non-empty text`)
    const key = normalized(display)
    if (!seen.has(key)) result.push(display)
    seen.add(key)
  }
  return result
}

function normalizeFixture(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schemaVersion !== 1) {
    throw inputError('fixture must be a schemaVersion 1 object')
  }
  if (!Array.isArray(raw.characters) || !raw.characters.length) {
    throw inputError('fixture.characters must be a non-empty array')
  }
  const ids = new Set()
  const names = new Map()
  let goldTraitCount = 0
  const characters = raw.characters.map((source, characterIndex) => {
    const id = String(source?.id || '').trim()
    const name = String(source?.name || '').trim()
    if (!id || !name || ids.has(id)) throw inputError(`invalid character at index ${characterIndex}`)
    ids.add(id)
    const aliases = uniqueStrings([name, ...(source.aliases ?? [])], `characters[${characterIndex}].aliases`)
    for (const alias of aliases) {
      const key = normalized(alias)
      const previous = names.get(key)
      if (previous && previous !== id) throw inputError(`ambiguous character alias: ${alias}`)
      names.set(key, id)
    }
    if (!Array.isArray(source.traits) || !source.traits.length) {
      throw inputError(`characters[${characterIndex}].traits must be non-empty`)
    }
    const accepted = new Map()
    const traits = source.traits.map((trait, traitIndex) => {
      const traitId = String(trait?.id || '').trim()
      const label = String(trait?.label || '').trim()
      if (!traitId || !label) throw inputError(`invalid trait at ${characterIndex}:${traitIndex}`)
      const surfaces = uniqueStrings(
        [label, ...(trait.accepted ?? [])],
        `characters[${characterIndex}].traits[${traitIndex}].accepted`
      )
      for (const surface of surfaces) {
        const key = normalized(surface)
        if (accepted.has(key) && accepted.get(key) !== traitId) {
          throw inputError(`accepted personality surface is ambiguous: ${surface}`)
        }
        accepted.set(key, traitId)
      }
      goldTraitCount += 1
      return { id: traitId, label, accepted: surfaces, mean: trait.mean, n: trait.n }
    })
    const contradictory = uniqueStrings(
      source.contradictory ?? [],
      `characters[${characterIndex}].contradictory`
    )
    const contradictoryKeys = new Set(contradictory.map(normalized))
    for (const key of contradictoryKeys) {
      if (accepted.has(key)) throw inputError(`surface is both accepted and contradictory: ${key}`)
    }
    return { id, name, aliases, traits, accepted, contradictory, contradictoryKeys }
  })
  return {
    id: String(raw.id || 'personality-fixture-v1'),
    source: raw.source ?? {},
    gates: {
      precision: raw.gates?.precision ?? 0.8,
      recall: raw.gates?.recall ?? 0.8,
      f1: raw.gates?.f1 ?? 0.8,
      traitCoverage: raw.gates?.traitCoverage ?? 0.8,
      descriptionCoverage: raw.gates?.descriptionCoverage ?? 0.8,
      uiCoreReady: raw.gates?.uiCoreReady ?? 0.8,
      voiceGenderConsistency: raw.gates?.voiceGenderConsistency ?? 0.8,
      contradictionRate: raw.gates?.contradictionRate ?? 0.02
    },
    characters,
    names,
    goldTraitCount
  }
}

export async function loadPersonalityFixture(fixturePath = DEFAULT_PERSONALITY_FIXTURE_PATH) {
  return normalizeFixture(JSON.parse(await readFile(fixturePath, 'utf8')))
}

export function extractMarkupCharacters(input) {
  const candidates = [
    input?.publication?.data?.markup?.characters,
    input?.publication?.data?.characters,
    input?.markup?.characters,
    input?.canonicalMarkupVersions?.[0]?.characters,
    input?.characters
  ]
  const characters = candidates.find(Array.isArray)
  if (!characters) throw inputError('input does not contain book-markup characters')
  return characters.map((row, index) => {
    const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? row.data
      : row
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw inputError(`characters[${index}] must be an object`)
    }
    const combined = { ...row, ...data }
    delete combined.data
    return combined
  })
}

function claimText(value) {
  if (typeof value === 'string') return value.trim()
  return typeof value?.value === 'string' ? value.value.trim() : ''
}

function profileSurfaces(profile) {
  return uniqueStrings(
    [profile.name, profile.fullName, ...(profile.aliases ?? [])].filter(Boolean),
    'profile aliases'
  )
}

function profileTraits(profile) {
  return Array.isArray(profile.traits)
    ? profile.traits.map(claimText).filter(Boolean)
    : []
}

function profileUiCoreReady(profile) {
  const identity = Boolean(
    String(profile.characterKey || profile.entityKey || '').trim() &&
    String(profile.name || profile.fullName || '').trim()
  )
  const first = Number(profile.firstAppearanceTextOffset)
  const warmup = Number(profile.warmupTextOffset)
  const timeline = Number.isSafeInteger(first) && first >= 0 &&
    Number.isSafeInteger(warmup) && warmup >= 0 && warmup <= first
  const creative = profile.creative && typeof profile.creative === 'object'
    ? profile.creative
    : profile
  return identity && timeline && Boolean(
    String(creative.greeting || '').trim() && String(creative.voice || '').trim()
  )
}

function profileVoiceGenderConsistent(profile) {
  const creative = profile.creative && typeof profile.creative === 'object'
    ? profile.creative
    : profile
  const voice = String(creative.voice || '').trim()
  const gender = claimText(profile.gender)
  if (gender !== 'male' && gender !== 'female') return voice === 'Erm'
  return voiceConfig(voice)?.gender === gender
}

export function scoreFrozenPersonality({ fixture: rawFixture, input }) {
  const fixture = rawFixture?.names ? rawFixture : normalizeFixture(rawFixture)
  const profiles = extractMarkupCharacters(input)
  const byCharacter = new Map(fixture.characters.map(({ id }) => [id, []]))
  const ambiguousProfiles = []
  for (const profile of profiles) {
    const matches = [...new Set(profileSurfaces(profile)
      .map((surface) => fixture.names.get(normalized(surface)))
      .filter(Boolean))]
    if (matches.length === 1) byCharacter.get(matches[0]).push(profile)
    else if (matches.length > 1) {
      ambiguousProfiles.push({
        name: profile.fullName || profile.name,
        matchedCharacterIds: matches.sort()
      })
    }
  }

  let predictionCount = 0
  let truePositiveCount = 0
  let contradictionCount = 0
  let traitCoveredCount = 0
  let descriptionCoveredCount = 0
  let uiCoreReadyCount = 0
  let voiceGenderConsistentCount = 0
  const characters = fixture.characters.map((gold) => {
    const rows = byCharacter.get(gold.id)
    const predictions = [...new Map(rows.flatMap(profileTraits)
      .map((value) => [normalized(value), value])).values()]
    const matchedTraitIds = new Set()
    const matches = []
    const unmatched = []
    const contradictions = []
    for (const value of predictions) {
      const key = normalized(value)
      const traitId = gold.accepted.get(key)
      if (traitId && !matchedTraitIds.has(traitId)) {
        matchedTraitIds.add(traitId)
        const trait = gold.traits.find(({ id }) => id === traitId)
        matches.push({ prediction: value, trait: { id: trait.id, label: trait.label } })
      } else {
        unmatched.push(value)
      }
      if (gold.contradictoryKeys.has(key)) contradictions.push(value)
    }
    const traitCovered = predictions.length > 0
    const descriptionCovered = rows.some(({ description }) => Boolean(claimText(description)))
    const uiCoreReady = rows.length > 0 && rows.every(profileUiCoreReady)
    const voiceGenderConsistent = rows.length > 0 && rows.every(profileVoiceGenderConsistent)
    predictionCount += predictions.length
    truePositiveCount += matches.length
    contradictionCount += contradictions.length
    traitCoveredCount += Number(traitCovered)
    descriptionCoveredCount += Number(descriptionCovered)
    uiCoreReadyCount += Number(uiCoreReady)
    voiceGenderConsistentCount += Number(voiceGenderConsistent)
    return {
      id: gold.id,
      name: gold.name,
      rowCount: rows.length,
      predictionCount: predictions.length,
      goldCount: gold.traits.length,
      metrics: metrics(matches.length, predictions.length, gold.traits.length),
      coverage: { traits: traitCovered, description: descriptionCovered, uiCoreReady, voiceGenderConsistent },
      matches,
      unmatched,
      contradictions
    }
  })
  const population = fixture.characters.length
  const micro = metrics(truePositiveCount, predictionCount, fixture.goldTraitCount)
  const coverage = {
    traits: ratio(traitCoveredCount, population),
    description: ratio(descriptionCoveredCount, population),
    uiCoreReady: ratio(uiCoreReadyCount, population),
    voiceGenderConsistency: ratio(voiceGenderConsistentCount, population)
  }
  const contradictionRate = ratio(contradictionCount, predictionCount)
  const checks = {
    precision: micro.precision >= fixture.gates.precision,
    recall: micro.recall >= fixture.gates.recall,
    f1: micro.f1 >= fixture.gates.f1,
    traitCoverage: coverage.traits >= fixture.gates.traitCoverage,
    descriptionCoverage: coverage.description >= fixture.gates.descriptionCoverage,
    uiCoreReady: coverage.uiCoreReady >= fixture.gates.uiCoreReady,
    voiceGenderConsistency: coverage.voiceGenderConsistency >= fixture.gates.voiceGenderConsistency,
    contradictionRate: contradictionRate <= fixture.gates.contradictionRate
  }
  return {
    fixture: {
      id: fixture.id,
      characterCount: population,
      goldTraitCount: fixture.goldTraitCount,
      source: fixture.source
    },
    observed: {
      inputCharacterCount: profiles.length,
      matchedProfileCount: [...byCharacter.values()].reduce((sum, rows) => sum + rows.length, 0),
      predictionCount,
      truePositiveCount,
      contradictionCount,
      ambiguousProfiles
    },
    metrics: { micro, coverage, contradictionRate },
    characters,
    gate: { thresholds: fixture.gates, checks, passed: Object.values(checks).every(Boolean) }
  }
}

function parseArgs(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true }
  const values = {}
  let pretty = false
  let requirePass = false
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--pretty') { pretty = true; continue }
    if (name === '--require-pass') { requirePass = true; continue }
    if (!['--input', '--fixture'].includes(name) || !argv[index + 1]) {
      throw inputError(`unsupported or incomplete option: ${name || '(empty)'}`)
    }
    values[name] = argv[++index]
  }
  if (!values['--input']) throw inputError('--input is required')
  return {
    help: false,
    inputPath: values['--input'],
    fixturePath: values['--fixture'] || DEFAULT_PERSONALITY_FIXTURE_PATH,
    pretty,
    requirePass
  }
}

async function runCli(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write('Usage: node evaluation/score-frozen-personality.mjs --input <book-json> [--fixture <gold-json>] [--pretty] [--require-pass]\n')
    return
  }
  const [fixture, input] = await Promise.all([
    loadPersonalityFixture(options.fixturePath),
    readFile(options.inputPath, 'utf8').then(JSON.parse)
  ])
  const result = scoreFrozenPersonality({ fixture, input })
  process.stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`)
  if (options.requirePass && !result.gate.passed) {
    throw Object.assign(new Error('frozen personality quality gate failed'), {
      code: 'PERSONALITY_QUALITY_GATE_FAILED'
    })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error?.code || 'UNKNOWN',
      message: error?.message || 'personality scoring failed'
    })}\n`)
    process.exitCode = 1
  })
}
