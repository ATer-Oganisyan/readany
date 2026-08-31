import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_IDENTITY_FIXTURE_PATH = path.join(
  directory,
  'identity',
  'pride-prejudice-bookcoref-v1.json'
)

function inputError(message) {
  return Object.assign(new TypeError(message), { code: 'IDENTITY_ACCEPTANCE_INPUT_INVALID' })
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function finiteCount(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000
}

function metrics(tp, predictionCount, goldCount) {
  const precision = predictionCount > 0 ? tp / predictionCount : 0
  const recall = goldCount > 0 ? tp / goldCount : 0
  const f1 = precision + recall > 0
    ? 2 * precision * recall / (precision + recall)
    : 0
  return {
    precision: rounded(precision),
    recall: rounded(recall),
    f1: rounded(f1)
  }
}

function stringArray(value, name) {
  if (value == null) return []
  if (!Array.isArray(value)) throw inputError(`${name} must be an array`)
  const result = []
  const seen = new Set()
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || !item.trim()) {
      throw inputError(`${name}[${index}] must be non-empty text`)
    }
    const display = item.trim().replace(/\s+/g, ' ')
    const key = normalizedName(display)
    if (!seen.has(key)) result.push(display)
    seen.add(key)
  }
  return result
}

function normalizeFixture(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw inputError('fixture must be an object')
  }
  if (raw.schemaVersion !== 1) throw inputError('fixture.schemaVersion must be 1')
  if (!Array.isArray(raw.characters) || raw.characters.length === 0) {
    throw inputError('fixture.characters must be a non-empty array')
  }

  const ids = new Set()
  const aliases = new Map()
  const characters = raw.characters.map((source, index) => {
    const id = String(source?.id || '').trim()
    const name = String(source?.name || '').trim()
    if (!id || !name) throw inputError(`fixture.characters[${index}] needs id and name`)
    if (ids.has(id)) throw inputError(`duplicate fixture character id: ${id}`)
    ids.add(id)
    const names = stringArray([name, ...(source.aliases ?? [])], `fixture.characters[${index}].aliases`)
    for (const alias of names) {
      const key = normalizedName(alias)
      const existing = aliases.get(key)
      if (existing && existing !== id) {
        throw inputError(`fixture alias ${JSON.stringify(alias)} belongs to both ${existing} and ${id}`)
      }
      aliases.set(key, id)
    }
    return {
      id,
      name,
      aliases: names,
      mentionCount: finiteCount(source.mentionCount),
      significant: source.significant === true
    }
  })

  const extras = new Map()
  const knownExtras = (raw.knownExtras ?? []).map((source, index) => {
    const id = String(source?.id || '').trim()
    const name = String(source?.name || '').trim()
    if (!id || !name) throw inputError(`fixture.knownExtras[${index}] needs id and name`)
    const names = stringArray([name, ...(source.aliases ?? [])], `fixture.knownExtras[${index}].aliases`)
    for (const alias of names) {
      const key = normalizedName(alias)
      if (aliases.has(key)) {
        throw inputError(`known extra alias ${JSON.stringify(alias)} overlaps gold identity`)
      }
      const existing = extras.get(key)
      if (existing && existing !== id) {
        throw inputError(`known extra alias ${JSON.stringify(alias)} is ambiguous`)
      }
      extras.set(key, id)
    }
    return { id, name, aliases: names, kind: source.kind ?? 'individual' }
  })

  const significantCount = characters.filter(({ significant }) => significant).length
  if (raw.goldCount != null && raw.goldCount !== characters.length) {
    throw inputError(`fixture.goldCount is ${raw.goldCount}, expected ${characters.length}`)
  }
  if (raw.significantCount != null && raw.significantCount !== significantCount) {
    throw inputError(`fixture.significantCount is ${raw.significantCount}, expected ${significantCount}`)
  }

  const collisionGuards = (raw.collisionGuards ?? []).map((source, index) => {
    const id = String(source?.id || '').trim()
    const surfaces = stringArray(
      source?.surfaces,
      `fixture.collisionGuards[${index}].surfaces`
    )
    const goldIds = stringArray(
      source?.goldIds,
      `fixture.collisionGuards[${index}].goldIds`
    )
    if (!id || surfaces.length === 0 || goldIds.length < 2) {
      throw inputError(
        `fixture.collisionGuards[${index}] needs id, surfaces, and at least two goldIds`
      )
    }
    for (const goldId of goldIds) {
      if (!ids.has(goldId)) {
        throw inputError(`fixture collision guard ${id} references unknown gold id: ${goldId}`)
      }
    }
    return {
      id,
      surfaces,
      goldIds,
      reason: String(source?.reason || '').trim()
    }
  })

  return {
    id: String(raw.id || 'identity-fixture-v1'),
    source: raw.source ?? {},
    characters,
    knownExtras,
    characterById: new Map(characters.map((character) => [character.id, character])),
    extraById: new Map(knownExtras.map((extra) => [extra.id, extra])),
    aliases,
    extras,
    collisionGuards,
    gates: {
      precision: raw.gates?.precision ?? 0.9,
      recall: raw.gates?.recall ?? 0.9,
      f1: raw.gates?.f1 ?? 0.9,
      criticalMerges: raw.gates?.criticalMerges ?? 0,
      duplicateRate: raw.gates?.duplicateRate ?? 0.05
    }
  }
}

export async function loadIdentityFixture(fixturePath = DEFAULT_IDENTITY_FIXTURE_PATH) {
  return normalizeFixture(JSON.parse(await readFile(fixturePath, 'utf8')))
}

function findRoster(input) {
  if (Array.isArray(input?.final?.roster)) return input.final.roster
  if (Array.isArray(input?.roster)) return input.roster
  if (Array.isArray(input?.characters)) return input.characters
  if (Array.isArray(input?.publication?.data?.markup?.characters)) {
    return input.publication.data.markup.characters
  }
  throw inputError(
    'input must contain final.roster, roster, characters, or publication.data.markup.characters'
  )
}

export function extractCompactRoster(input) {
  const roster = findRoster(input).map((source, index) => {
    const canonicalName = String(
      source?.canonicalName ?? source?.name ?? source?.fullName ?? ''
    ).trim().replace(/\s+/g, ' ')
    if (!canonicalName) throw inputError(`roster[${index}] has no canonicalName or name`)
    const aliases = stringArray(source.aliases ?? [], `roster[${index}].aliases`)
      .filter((alias) => normalizedName(alias) !== normalizedName(canonicalName))
    const evidence = Array.isArray(source.evidence) ? source.evidence : []
    const identityEvidenceIds = Array.isArray(source.identityEvidenceIds)
      ? source.identityEvidenceIds
      : []
    return {
      entityKey: String(
        source.entityKey ?? source.characterKey ?? source.id ?? `roster-${index + 1}`
      ),
      canonicalName,
      aliases,
      resolutionStatus: source.resolutionStatus ?? null,
      observationCount: finiteCount(
        source.observationCount,
        evidence.length || identityEvidenceIds.length
      )
    }
  })
  return roster.some(({ resolutionStatus }) => resolutionStatus != null)
    ? roster.filter(({ resolutionStatus }) => resolutionStatus === 'confirmed')
    : roster
}

function rosterSummary(row) {
  return {
    entityKey: row.entityKey,
    canonicalName: row.canonicalName,
    aliases: row.aliases,
    observationCount: row.observationCount
  }
}

function compareRows(left, right, gold) {
  return right.observationCount - left.observationCount ||
    Number(normalizedName(right.canonicalName) === normalizedName(gold.name)) -
      Number(normalizedName(left.canonicalName) === normalizedName(gold.name)) ||
    left.entityKey.localeCompare(right.entityKey, 'en')
}

function goldSummary(fixture, id) {
  const gold = fixture.characterById.get(id)
  return {
    id: gold.id,
    name: gold.name,
    significant: gold.significant,
    mentionCount: gold.mentionCount
  }
}

/**
 * Strict frozen identity scoring.
 *
 * A row whose surfaces touch two gold identities is a MERGE and receives no
 * TP. A row must have a fixture-backed canonical name; an unknown generated
 * canonical with only a known alias is left unmatched instead of receiving a
 * hopeful match. Additional pure rows for one gold identity are DUP rows.
 */
export function scoreFrozenIdentity({ fixture: rawFixture, input }) {
  const fixture = rawFixture?.characterById ? rawFixture : normalizeFixture(rawFixture)
  const roster = extractCompactRoster(input)
  const pureRowsByGold = new Map()
  const merges = []
  const extras = []
  const unmatched = []

  for (const row of roster) {
    const surfaces = [row.canonicalName, ...row.aliases]
    const matchedGoldIds = [...new Set(surfaces
      .map((surface) => fixture.aliases.get(normalizedName(surface)))
      .filter(Boolean))].sort()
    const canonicalGoldId = fixture.aliases.get(normalizedName(row.canonicalName)) ?? null
    const canonicalExtraId = fixture.extras.get(normalizedName(row.canonicalName)) ?? null

    if (matchedGoldIds.length > 1) {
      merges.push({
        row: rosterSummary(row),
        matchedGold: matchedGoldIds.map((id) => goldSummary(fixture, id))
      })
      continue
    }
    if (canonicalGoldId && matchedGoldIds.length === 1 && matchedGoldIds[0] === canonicalGoldId) {
      const values = pureRowsByGold.get(canonicalGoldId) ?? []
      values.push(row)
      pureRowsByGold.set(canonicalGoldId, values)
      continue
    }
    if (canonicalExtraId && matchedGoldIds.length === 0) {
      const known = fixture.extraById.get(canonicalExtraId)
      extras.push({ row: rosterSummary(row), extra: { id: known.id, name: known.name, kind: known.kind } })
      continue
    }
    unmatched.push({
      row: rosterSummary(row),
      matchedGold: matchedGoldIds.map((id) => goldSummary(fixture, id)),
      reason: matchedGoldIds.length === 1
        ? 'canonical_name_not_frozen_for_matched_identity'
        : 'no_frozen_identity_match'
    })
  }

  const matches = []
  const duplicateGroups = []
  const duplicateRows = []
  for (const [goldId, rows] of pureRowsByGold) {
    const gold = fixture.characterById.get(goldId)
    const ordered = [...rows].sort((left, right) => compareRows(left, right, gold))
    matches.push({ gold: goldSummary(fixture, goldId), row: rosterSummary(ordered[0]) })
    if (ordered.length > 1) {
      const duplicates = ordered.slice(1).map(rosterSummary)
      duplicateRows.push(...duplicates.map((row) => ({ gold: goldSummary(fixture, goldId), row })))
      duplicateGroups.push({
        gold: goldSummary(fixture, goldId),
        anchor: rosterSummary(ordered[0]),
        duplicates
      })
    }
  }
  matches.sort((left, right) => left.gold.id.localeCompare(right.gold.id, 'en'))
  duplicateGroups.sort((left, right) => left.gold.id.localeCompare(right.gold.id, 'en'))

  const matchedGoldIds = new Set(pureRowsByGold.keys())
  const fn = fixture.characters
    .filter(({ id }) => !matchedGoldIds.has(id))
    .map(({ id }) => goldSummary(fixture, id))
  const significantGold = fixture.characters.filter(({ significant }) => significant)
  const significantMatches = matches.filter(({ gold }) => gold.significant)
  const significantDuplicates = duplicateRows.filter(({ gold }) => gold.significant)
  const significantMerges = merges.filter(({ matchedGold }) =>
    matchedGold.some(({ significant }) => significant)
  )
  const significantFn = fn.filter(({ significant }) => significant)

  const fullMetrics = metrics(matches.length, roster.length, fixture.characters.length)
  const significantPredictionCount = significantMatches.length +
    significantDuplicates.length + significantMerges.length + unmatched.length
  const significantMetrics = metrics(
    significantMatches.length,
    significantPredictionCount,
    significantGold.length
  )
  const duplicateRate = roster.length > 0 ? rounded(duplicateRows.length / roster.length) : 0
  const gateChecks = {
    precision: significantMetrics.precision >= fixture.gates.precision,
    recall: significantMetrics.recall >= fixture.gates.recall,
    f1: significantMetrics.f1 >= fixture.gates.f1,
    criticalMerges: merges.length <= fixture.gates.criticalMerges,
    duplicateRate: duplicateRate <= fixture.gates.duplicateRate
  }

  return {
    fixture: {
      id: fixture.id,
      goldCount: fixture.characters.length,
      significantCount: significantGold.length,
      source: fixture.source
    },
    input: { rosterCount: roster.length },
    full: {
      tp: matches.length,
      fn: fn.length,
      duplicateRows: duplicateRows.length,
      mergeRows: merges.length,
      extraRows: extras.length,
      unmatchedRows: unmatched.length,
      fp: roster.length - matches.length,
      duplicateRate,
      ...fullMetrics
    },
    significant: {
      tp: significantMatches.length,
      fn: significantFn.length,
      duplicateRows: significantDuplicates.length,
      mergeRows: significantMerges.length,
      unmatchedRows: unmatched.length,
      predictionCount: significantPredictionCount,
      ...significantMetrics
    },
    gate: {
      passed: Object.values(gateChecks).every(Boolean),
      thresholds: fixture.gates,
      checks: gateChecks
    },
    classifications: {
      matches,
      duplicateGroups,
      merges,
      extras,
      unmatched,
      fn,
      significantFn
    }
  }
}

function parseArguments(argv) {
  const result = { fixturePath: DEFAULT_IDENTITY_FIXTURE_PATH, pretty: false, requirePass: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--input') result.inputPath = argv[++index]
    else if (value === '--fixture') result.fixturePath = argv[++index]
    else if (value === '--pretty') result.pretty = true
    else if (value === '--require-pass') result.requirePass = true
    else throw inputError(`unknown argument: ${value}`)
  }
  if (!result.inputPath) throw inputError('--input is required')
  return result
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2))
  const [fixture, input] = await Promise.all([
    loadIdentityFixture(path.resolve(options.fixturePath)),
    readFile(path.resolve(options.inputPath), 'utf8').then(JSON.parse)
  ])
  const score = scoreFrozenIdentity({ fixture, input })
  process.stdout.write(`${JSON.stringify(score, null, options.pretty ? 2 : 0)}\n`)
  if (options.requirePass && !score.gate.passed) process.exitCode = 2
}
