/**
 * Card-content acceptance for the character-cards pipeline (work order P3/P4).
 *
 * `score-frozen-identity.mjs` answers "did we find the right people". This answers
 * "is the card we built for them correct and spoiler-free":
 *
 *   nonCharacterRows      rows that are not characters of the work at all
 *   genderAccuracy        gold gender vs card gender on matched rows
 *   fullNameCoverage      card carries the character's full name (contract `fullName`)
 *   appearanceCoverage    card carries an appearance passport (D4 needs it for portraits)
 *   traitsInRange         3..6 traits, as `character-card-prompt-v1` requires
 *   traitLanguagePurity   traits written in the book's language, not the model's
 *   spoilerViolations     card text states a fact revealed past its own card window (D1)
 *
 * The window is the D1 rule: [0, end of the chapter following the chapter that contains
 * the character's first mention]. Scoring today's `book-markup-v3` therefore reports what
 * *would* violate D1 once windows exist, which is the point of the baseline.
 *
 *   node evaluation/score-character-cards.mjs \
 *     --fixture evaluation/cards/evgeniy-onegin-ru-card-v1.json \
 *     --input /tmp/onegin.roster.json --pretty
 */
import { readFile } from 'node:fs/promises'

function inputError(message) {
  return Object.assign(new TypeError(message), { code: 'CARD_ACCEPTANCE_INPUT_INVALID' })
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000
}

function ratio(hits, total) {
  return total > 0 ? rounded(hits / total) : 1
}

const CYRILLIC = /\p{Script=Cyrillic}/u
const LATIN = /\p{Script=Latin}/u

/** A trait is a language leak when it carries Latin letters and no Cyrillic ones. */
export function isLanguageLeak(trait, language) {
  if (language !== 'ru') return false
  const value = String(trait || '')
  return LATIN.test(value) && !CYRILLIC.test(value)
}

function normalizeFixture(raw) {
  if (!raw || typeof raw !== 'object') throw inputError('fixture must be an object')
  if (raw.schemaVersion !== 1) throw inputError('fixture.schemaVersion must be 1')
  if (!Array.isArray(raw.characters) || raw.characters.length === 0) {
    throw inputError('fixture.characters must be a non-empty array')
  }
  if (!Array.isArray(raw.chapters) || raw.chapters.length === 0) {
    throw inputError('fixture.chapters must be a non-empty array')
  }
  return {
    id: String(raw.id || 'card-fixture-v1'),
    identityFixture: raw.identityFixture ?? null,
    source: raw.source ?? {},
    language: raw.source?.language ?? 'ru',
    chapters: [...raw.chapters].sort((left, right) => left.startOffset - right.startOffset),
    characters: raw.characters,
    characterById: new Map(raw.characters.map((character) => [character.id, character])),
    nonCharacters: new Map((raw.nonCharacters ?? []).map((entry) =>
      [normalizedName(entry.name), entry])),
    gates: {
      genderAccuracy: raw.gates?.genderAccuracy ?? 0.95,
      fullNameCoverage: raw.gates?.fullNameCoverage ?? 0.9,
      appearanceCoverage: raw.gates?.appearanceCoverage ?? 0.9,
      traitsInRange: raw.gates?.traitsInRange ?? 0.9,
      traitLanguagePurity: raw.gates?.traitLanguagePurity ?? 1,
      nonCharacterRows: raw.gates?.nonCharacterRows ?? 0,
      spoilerViolations: raw.gates?.spoilerViolations ?? 0
    }
  }
}

export async function loadCardFixture(fixturePath) {
  return normalizeFixture(JSON.parse(await readFile(fixturePath, 'utf8')))
}

/** D1 card window: start of the book to the end of the chapter after the first mention. */
export function cardWindow(chapters, firstMentionTextOffset) {
  const offset = Number.isFinite(firstMentionTextOffset) ? firstMentionTextOffset : 0
  let index = chapters.findIndex(
    (chapter) => offset >= chapter.startOffset && offset < chapter.endOffset
  )
  if (index < 0) index = 0
  const last = chapters[Math.min(index + 1, chapters.length - 1)]
  return { startOffset: 0, endOffset: last.endOffset, chapterIndexes: [index, index + 1] }
}

/**
 * The appearance passport is scanned along with the prose: under D4 it is what the
 * portrait is drawn from, so a fact leaked there reaches the reader as a picture.
 */
function cardText(row) {
  const profile = row.profile ?? {}
  return [
    profile.role,
    profile.description,
    profile.bio?.value ?? profile.bio,
    profile.appearancePrompt,
    ...(Array.isArray(profile.traits) ? profile.traits : []),
    ...(Array.isArray(profile.locations) ? profile.locations : [])
  ].filter(Boolean).join(' \n ')
}

function traitValues(row) {
  const traits = row.profile?.traits
  if (!Array.isArray(traits)) return []
  return traits.map((trait) => (typeof trait === 'string' ? trait : trait?.value)).filter(Boolean)
}

function findRoster(input) {
  if (Array.isArray(input?.characters)) return input.characters
  if (Array.isArray(input?.cards)) return input.cards
  throw inputError('input must contain characters or cards')
}

/**
 * Maps roster rows onto gold ids by canonical name and alias, reusing the identity
 * fixture's alias table when one is supplied. Rows that match no gold identity are
 * reported, not silently dropped.
 */
function matchRows(fixture, roster, aliasIndex) {
  const byGold = new Map()
  const unmatched = []
  for (const row of roster) {
    const surfaces = [row.canonicalName ?? row.name, row.fullName, ...(row.aliases ?? [])]
      .filter(Boolean)
    const goldIds = [...new Set(surfaces
      .map((surface) => aliasIndex.get(normalizedName(surface)))
      .filter(Boolean))]
    if (goldIds.length !== 1) {
      unmatched.push({ name: row.canonicalName ?? row.name, goldIds })
      continue
    }
    const values = byGold.get(goldIds[0]) ?? []
    values.push(row)
    byGold.set(goldIds[0], values)
  }
  return { byGold, unmatched }
}

export function scoreCharacterCards({ fixture: rawFixture, identityFixture = null, input }) {
  const fixture = rawFixture?.characterById ? rawFixture : normalizeFixture(rawFixture)
  const roster = findRoster(input)

  const aliasIndex = new Map()
  for (const character of fixture.characters) {
    aliasIndex.set(normalizedName(character.name), character.id)
    if (character.fullName) aliasIndex.set(normalizedName(character.fullName), character.id)
  }
  for (const character of identityFixture?.characters ?? []) {
    for (const surface of [character.name, ...(character.aliases ?? [])]) {
      if (!aliasIndex.has(normalizedName(surface))) {
        aliasIndex.set(normalizedName(surface), character.id)
      }
    }
  }

  const { byGold, unmatched } = matchRows(fixture, roster, aliasIndex)

  const nonCharacterRows = []
  for (const row of roster) {
    const name = normalizedName(row.canonicalName ?? row.name)
    const known = fixture.nonCharacters.get(name)
    if (known) nonCharacterRows.push({ name: row.canonicalName ?? row.name, ...known })
  }
  for (const [goldId, rows] of byGold) {
    const gold = fixture.characterById.get(goldId)
    if (gold.kind === 'person') continue
    for (const row of rows) {
      nonCharacterRows.push({
        name: row.canonicalName ?? row.name,
        kind: gold.kind,
        reason: `gold-помечен как ${gold.kind}, карточка персонажа не полагается`
      })
    }
  }

  const genderChecks = []
  const fullNameChecks = []
  const appearanceChecks = []
  const traitsRangeChecks = []
  const traitLeaks = []
  const spoilerViolations = []

  for (const [goldId, rows] of byGold) {
    const gold = fixture.characterById.get(goldId)
    if (gold.kind !== 'person') continue
    const window = cardWindow(fixture.chapters, gold.firstMentionTextOffset)
    for (const row of rows) {
      const name = row.canonicalName ?? row.name
      const profile = row.profile ?? {}

      if (gold.gender) {
        genderChecks.push({
          id: goldId,
          name,
          expected: gold.gender,
          actual: profile.gender ?? null,
          ok: profile.gender === gold.gender
        })
      }

      const cardFullName = row.fullName || profile.fullName || ''
      if (gold.fullName) {
        fullNameChecks.push({
          id: goldId,
          name,
          expected: gold.fullName,
          actual: cardFullName || null,
          ok: normalizedName(cardFullName) === normalizedName(gold.fullName)
        })
      }

      appearanceChecks.push({
        id: goldId,
        name,
        ok: Boolean(String(profile.appearancePrompt || '').trim())
      })

      const traits = traitValues(row)
      traitsRangeChecks.push({
        id: goldId, name, count: traits.length, ok: traits.length >= 3 && traits.length <= 6
      })
      for (const trait of traits) {
        if (isLanguageLeak(trait, fixture.language)) {
          traitLeaks.push({ id: goldId, name, trait })
        }
      }

      const haystack = normalizedName(cardText(row))
      for (const spoiler of gold.spoilers ?? []) {
        if (spoiler.revealedAtOffset <= window.endOffset) continue
        const hit = (spoiler.markers ?? []).find(
          (marker) => haystack.includes(normalizedName(marker))
        )
        if (hit) {
          spoilerViolations.push({
            id: goldId,
            name,
            spoiler: spoiler.id,
            label: spoiler.label,
            marker: hit,
            revealedAtOffset: spoiler.revealedAtOffset,
            window
          })
        }
      }
    }
  }

  const counted = (checks) => checks.filter(({ ok }) => ok).length
  const metrics = {
    nonCharacterRows: nonCharacterRows.length,
    genderAccuracy: ratio(counted(genderChecks), genderChecks.length),
    fullNameCoverage: ratio(counted(fullNameChecks), fullNameChecks.length),
    appearanceCoverage: ratio(counted(appearanceChecks), appearanceChecks.length),
    traitsInRange: ratio(counted(traitsRangeChecks), traitsRangeChecks.length),
    traitLanguagePurity: ratio(
      traitsRangeChecks.length - new Set(traitLeaks.map(({ id }) => id)).size,
      traitsRangeChecks.length
    ),
    spoilerViolations: spoilerViolations.length
  }

  const checks = {
    nonCharacterRows: metrics.nonCharacterRows <= fixture.gates.nonCharacterRows,
    genderAccuracy: metrics.genderAccuracy >= fixture.gates.genderAccuracy,
    fullNameCoverage: metrics.fullNameCoverage >= fixture.gates.fullNameCoverage,
    appearanceCoverage: metrics.appearanceCoverage >= fixture.gates.appearanceCoverage,
    traitsInRange: metrics.traitsInRange >= fixture.gates.traitsInRange,
    traitLanguagePurity: metrics.traitLanguagePurity >= fixture.gates.traitLanguagePurity,
    spoilerViolations: metrics.spoilerViolations <= fixture.gates.spoilerViolations
  }

  return {
    fixture: { id: fixture.id, identityFixture: fixture.identityFixture, source: fixture.source },
    input: { rosterCount: roster.length, matchedGold: byGold.size },
    metrics,
    gate: { passed: Object.values(checks).every(Boolean), thresholds: fixture.gates, checks },
    findings: {
      nonCharacterRows,
      genderMismatches: genderChecks.filter(({ ok }) => !ok),
      missingFullNames: fullNameChecks.filter(({ ok }) => !ok),
      missingAppearance: appearanceChecks.filter(({ ok }) => !ok),
      traitsOutOfRange: traitsRangeChecks.filter(({ ok }) => !ok),
      traitLeaks,
      spoilerViolations,
      unmatchedRows: unmatched
    }
  }
}

function parseArguments(argv) {
  const result = { pretty: false, requirePass: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--input') result.inputPath = argv[++index]
    else if (value === '--fixture') result.fixturePath = argv[++index]
    else if (value === '--identity-fixture') result.identityPath = argv[++index]
    else if (value === '--pretty') result.pretty = true
    else if (value === '--require-pass') result.requirePass = true
    else throw inputError(`unknown argument: ${value}`)
  }
  if (!result.fixturePath) throw inputError('--fixture is required')
  if (!result.inputPath) throw inputError('--input is required')
  return result
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const fixture = await loadCardFixture(options.fixturePath)
  const identityFixture = options.identityPath
    ? JSON.parse(await readFile(options.identityPath, 'utf8'))
    : null
  const input = JSON.parse(await readFile(options.inputPath, 'utf8'))
  const report = scoreCharacterCards({ fixture, identityFixture, input })
  process.stdout.write(`${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`)
  if (options.requirePass && !report.gate.passed) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
