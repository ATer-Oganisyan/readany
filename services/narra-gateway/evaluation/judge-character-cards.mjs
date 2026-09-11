/**
 * LLM-judge acceptance for appearance and biography on MAIN characters
 * (work order P3/P4, `docs/work-orders/character-cards-benchmark-ru.md`).
 *
 * `score-character-cards.mjs` checks what can be checked mechanically: fields present,
 * gender right, no fact from beyond the window. It cannot tell whether «Портрет Зарецкого
 * без добавления неподтверждённых деталей внешности» is a usable appearance passport, or
 * whether a biography quietly swapped one character's face onto another. That judgment is
 * what this file buys, against gold facts each anchored to a verbatim quote and offset.
 *
 * The model is injected, so the same harness runs against LiteLLM, the internal generation
 * service, or a recorded verdict file:
 *
 *   node evaluation/judge-character-cards.mjs \
 *     --fixture evaluation/cards/deti-kapitana-granta-ru-appearance-bio-v1.json \
 *     --identity-fixture evaluation/identity/deti-kapitana-granta-ru-v1.json \
 *     --input /tmp/grant.roster.json --out /tmp/grant.verdicts.json --pretty
 *
 * With `--verdicts <file>` it scores previously recorded verdicts and calls no model at
 * all, which is how the frozen baseline in `test/fixtures/` stays reproducible offline.
 * `--prompts <dir>` writes the judge prompts without calling anything, for a manual pass.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

function inputError(message) {
  return Object.assign(new TypeError(message), { code: 'CARD_JUDGE_INPUT_INVALID' })
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

export const JUDGE_PROMPT_VERSION = 'character-card-judge-v1'

const SYSTEM_PROMPT = `Ты — строгий литературовед-эксперт. Тебе дают эталонные факты о внешности
и биографии персонажа книги (каждый факт подтверждён дословной цитатой из текста) и карточку
персонажа, сгенерированную продуктом. Нужно сравнить карточку с эталоном.

Правила:
1. Эталон — единственный источник истины. Твои собственные знания о книге используй только
   чтобы распознать смешение персонажей, но не чтобы добавить факты в эталон.
2. Факт считается покрытым, если карточка передаёт его по смыслу, пусть другими словами.
3. Противоречие major — карточка утверждает обратное эталону или приписывает персонажу
   приметы другого персонажа. Противоречие minor — неточность в детали или в оттенке.
4. unsupportedClaims — конкретное фактическое утверждение, которого нет в эталоне и которое
   при этом противоречит книге или не поддаётся проверке. Если утверждение явно взято из
   книги, но в эталон не попало, клади его в notInGold, а не в unsupportedClaims: это
   пробел эталона, а не вина карточки. Общие оценочные слова («добрый», «храбрый»)
   не считай ни тем, ни другим.
5. portraitUsable — можно ли по appearancePrompt карточки нарисовать портрет, который
   читатель узнает как этого персонажа. Пустой или пустословный prompt («портрет без
   добавления деталей») — false.
6. Если эталон говорит describedInText: false, любая конкретная физическая примета
   в карточке — unsupported, а при наличии forbidden-записи ещё и major-противоречие.

Отвечай ТОЛЬКО валидным JSON без markdown-ограждений.`

function factLines(facts) {
  if (!facts?.length) return '  (в тексте примет нет)'
  return facts.map((fact) => {
    const quote = fact.quote ? ` | цитата: «${fact.quote}»` : ''
    const offset = Number.isFinite(fact.quoteOffset) ? ` @${fact.quoteOffset}` : ''
    const reveal = Number.isFinite(fact.revealedAtOffset) ? ` | раскрыт @${fact.revealedAtOffset}` : ''
    return `  - [${fact.id}] (${fact.importance}) ${fact.value}${quote}${offset}${reveal}`
  }).join('\n')
}

function forbiddenLines(entries) {
  if (!entries?.length) return '  (нет)'
  return entries.map((entry) => `  - [${entry.id}] ${entry.value} — ${entry.reason}`).join('\n')
}

export function buildJudgePrompt({ gold, row }) {
  const profile = row.profile ?? {}
  const traits = (Array.isArray(profile.traits) ? profile.traits : [])
    .map((trait) => (typeof trait === 'string' ? trait : trait?.value))
    .filter(Boolean)
  const card = [
    `имя в карточке: ${row.canonicalName ?? row.name}`,
    `полное имя: ${row.fullName || profile.fullName || '(пусто)'}`,
    `роль: ${profile.role || '(пусто)'}`,
    `пол: ${profile.gender ?? '(пусто)'}`,
    `возраст: ${profile.age ?? '(пусто)'}`,
    `описание/биография: ${profile.description || profile.bio?.value || profile.bio || '(пусто)'}`,
    `черты: ${traits.length ? traits.join(', ') : '(пусто)'}`,
    `appearancePrompt: ${profile.appearancePrompt || '(пусто)'}`
  ].join('\n')

  const user = `ПЕРСОНАЖ: ${gold.name}

ЭТАЛОН — ВНЕШНОСТЬ (describedInText: ${gold.appearance.describedInText}):
${gold.appearance.note ? `  примечание: ${gold.appearance.note}\n` : ''}${factLines(gold.appearance.facts)}
  запрещено утверждать:
${forbiddenLines(gold.appearance.forbidden)}

ЭТАЛОН — БИОГРАФИЯ:
${factLines(gold.biography.facts)}

КАРТОЧКА ИЗ ПРОДУКТА:
${card}

Верни JSON строго такой формы:
{
  "appearance": {
    "coveredFactIds": ["id", ...],
    "contradictions": [{"factId": "id или null", "cardClaim": "...", "goldSays": "...", "severity": "major|minor"}],
    "unsupportedClaims": [{"cardClaim": "...", "why": "..."}],
    "notInGold": [{"cardClaim": "...", "why": "..."}],
    "portraitUsable": true,
    "score": 0.0,
    "rationale": "одно-два предложения"
  },
  "biography": {
    "coveredFactIds": ["id", ...],
    "contradictions": [{"factId": "id или null", "cardClaim": "...", "goldSays": "...", "severity": "major|minor"}],
    "unsupportedClaims": [{"cardClaim": "...", "why": "..."}],
    "notInGold": [{"cardClaim": "...", "why": "..."}],
    "score": 0.0,
    "rationale": "одно-два предложения"
  }
}`

  return {
    promptVersion: JUDGE_PROMPT_VERSION,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user }
    ]
  }
}

function parseVerdict(raw, judgeId) {
  const text = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw inputError(`judge returned invalid JSON for ${judgeId}`)
  }
  for (const section of ['appearance', 'biography']) {
    const value = parsed?.[section]
    if (!value || typeof value !== 'object') {
      throw inputError(`judge verdict for ${judgeId} has no ${section}`)
    }
    value.coveredFactIds = Array.isArray(value.coveredFactIds) ? value.coveredFactIds : []
    value.contradictions = Array.isArray(value.contradictions) ? value.contradictions : []
    value.unsupportedClaims = Array.isArray(value.unsupportedClaims) ? value.unsupportedClaims : []
    value.notInGold = Array.isArray(value.notInGold) ? value.notInGold : []
    value.score = Number.isFinite(value.score) ? value.score : 0
  }
  parsed.appearance.portraitUsable = parsed.appearance.portraitUsable === true
  return parsed
}

/** Builds one judge task per roster row that maps onto a gold main character. */
export function buildJudgeTasks({ fixture, identityFixture = null, input }) {
  const roster = Array.isArray(input?.characters) ? input.characters : []
  const aliasIndex = new Map()
  for (const character of fixture.characters) {
    aliasIndex.set(normalizedName(character.name), character.id)
  }
  for (const character of identityFixture?.characters ?? []) {
    for (const surface of [character.name, ...(character.aliases ?? [])]) {
      const key = normalizedName(surface)
      // Aliases only resolve to gold ids the appearance/bio fixture actually covers.
      if (!aliasIndex.has(key) && fixture.characterById.has(character.id)) {
        aliasIndex.set(key, character.id)
      }
    }
  }

  const tasks = []
  for (const row of roster) {
    const surfaces = [row.canonicalName ?? row.name, row.fullName].filter(Boolean)
    const goldIds = [...new Set(surfaces
      .map((surface) => aliasIndex.get(normalizedName(surface)))
      .filter(Boolean))]
    if (goldIds.length !== 1) continue
    const gold = fixture.characterById.get(goldIds[0])
    tasks.push({
      judgeId: `${gold.id}::${normalizedName(row.canonicalName ?? row.name).replace(/ /g, '-')}`,
      goldId: gold.id,
      goldName: gold.name,
      rowName: row.canonicalName ?? row.name,
      ...buildJudgePrompt({ gold, row })
    })
  }
  return tasks
}

function normalizeFixture(raw) {
  if (!raw || typeof raw !== 'object') throw inputError('fixture must be an object')
  if (raw.schemaVersion !== 1) throw inputError('fixture.schemaVersion must be 1')
  if (!Array.isArray(raw.characters) || raw.characters.length === 0) {
    throw inputError('fixture.characters must be a non-empty array')
  }
  return {
    id: String(raw.id || 'appearance-bio-fixture-v1'),
    source: raw.source ?? {},
    characters: raw.characters,
    characterById: new Map(raw.characters.map((character) => [character.id, character])),
    gates: {
      appearanceCoreCoverage: raw.gates?.appearanceCoreCoverage ?? 0.7,
      appearanceMajorContradictions: raw.gates?.appearanceMajorContradictions ?? 0,
      appearanceInventionRate: raw.gates?.appearanceInventionRate ?? 0.1,
      portraitUsableRate: raw.gates?.portraitUsableRate ?? 0.9,
      bioCoreCoverage: raw.gates?.bioCoreCoverage ?? 0.6,
      bioMajorContradictions: raw.gates?.bioMajorContradictions ?? 0,
      bioInventionRate: raw.gates?.bioInventionRate ?? 0.1
    }
  }
}

export async function loadAppearanceBioFixture(fixturePath) {
  return normalizeFixture(JSON.parse(await readFile(fixturePath, 'utf8')))
}

function coreFactIds(facts) {
  return (facts ?? []).filter(({ importance }) => importance === 'core').map(({ id }) => id)
}

function majorCount(contradictions) {
  return contradictions.filter(({ severity }) => severity === 'major').length
}

/**
 * Aggregates verdicts. When a character was split into several rows the best row wins the
 * coverage credit, because coverage asks whether the product knows the fact at all; the
 * contradictions of every row still count, because the reader sees every card.
 */
export function scoreJudgeVerdicts({ fixture: rawFixture, verdicts }) {
  const fixture = rawFixture?.characterById ? rawFixture : normalizeFixture(rawFixture)
  if (!Array.isArray(verdicts) || verdicts.length === 0) {
    throw inputError('verdicts must be a non-empty array')
  }

  const byGold = new Map()
  for (const entry of verdicts) {
    const gold = fixture.characterById.get(entry.goldId)
    if (!gold) throw inputError(`verdict references unknown gold id: ${entry.goldId}`)
    const values = byGold.get(entry.goldId) ?? []
    values.push(entry)
    byGold.set(entry.goldId, values)
  }

  const perCharacter = []
  let appearanceCoreTotal = 0
  let appearanceCoreCovered = 0
  let bioCoreTotal = 0
  let bioCoreCovered = 0
  let appearanceMajor = 0
  let bioMajor = 0
  let rowsWithAppearanceInvention = 0
  let rowsWithBioInvention = 0
  let portraitUsableRows = 0
  let portraitScoredRows = 0
  let rowCount = 0

  for (const gold of fixture.characters) {
    const entries = byGold.get(gold.id)
    if (!entries) continue
    // A character the book never describes cannot yield a usable portrait, and an empty
    // appearance passport is the correct answer there — so those rows are left out of the rate.
    const portraitScored = gold.appearance?.describedInText === true
    const appearanceCore = coreFactIds(gold.appearance?.facts)
    const bioCore = coreFactIds(gold.biography?.facts)

    const appearanceHits = new Set()
    const bioHits = new Set()
    for (const entry of entries) {
      rowCount += 1
      for (const id of entry.verdict.appearance.coveredFactIds) {
        if (appearanceCore.includes(id)) appearanceHits.add(id)
      }
      for (const id of entry.verdict.biography.coveredFactIds) {
        if (bioCore.includes(id)) bioHits.add(id)
      }
      appearanceMajor += majorCount(entry.verdict.appearance.contradictions)
      bioMajor += majorCount(entry.verdict.biography.contradictions)
      if (entry.verdict.appearance.unsupportedClaims.length > 0) rowsWithAppearanceInvention += 1
      if (entry.verdict.biography.unsupportedClaims.length > 0) rowsWithBioInvention += 1
      if (portraitScored) {
        portraitScoredRows += 1
        if (entry.verdict.appearance.portraitUsable) portraitUsableRows += 1
      }
    }

    appearanceCoreTotal += appearanceCore.length
    appearanceCoreCovered += appearanceHits.size
    bioCoreTotal += bioCore.length
    bioCoreCovered += bioHits.size

    perCharacter.push({
      goldId: gold.id,
      name: gold.name,
      rows: entries.map(({ rowName }) => rowName),
      appearance: {
        coreTotal: appearanceCore.length,
        coreCovered: appearanceHits.size,
        coverage: appearanceCore.length > 0
          ? ratio(appearanceHits.size, appearanceCore.length)
          : null,
        majorContradictions: entries.reduce(
          (sum, entry) => sum + majorCount(entry.verdict.appearance.contradictions), 0
        ),
        unsupportedClaims: entries.flatMap((entry) => entry.verdict.appearance.unsupportedClaims),
        notInGold: entries.flatMap((entry) => entry.verdict.appearance.notInGold),
        portraitScored,
        portraitUsable: entries.some((entry) => entry.verdict.appearance.portraitUsable),
        score: rounded(
          entries.reduce((sum, entry) => sum + entry.verdict.appearance.score, 0) / entries.length
        )
      },
      biography: {
        coreTotal: bioCore.length,
        coreCovered: bioHits.size,
        coverage: bioCore.length > 0 ? ratio(bioHits.size, bioCore.length) : null,
        majorContradictions: entries.reduce(
          (sum, entry) => sum + majorCount(entry.verdict.biography.contradictions), 0
        ),
        unsupportedClaims: entries.flatMap((entry) => entry.verdict.biography.unsupportedClaims),
        notInGold: entries.flatMap((entry) => entry.verdict.biography.notInGold),
        score: rounded(
          entries.reduce((sum, entry) => sum + entry.verdict.biography.score, 0) / entries.length
        )
      }
    })
  }

  const metrics = {
    judgedCharacters: perCharacter.length,
    judgedRows: rowCount,
    appearanceCoreCoverage: ratio(appearanceCoreCovered, appearanceCoreTotal),
    appearanceMajorContradictions: appearanceMajor,
    appearanceInventionRate: ratio(rowsWithAppearanceInvention, rowCount),
    portraitUsableRate: ratio(portraitUsableRows, portraitScoredRows),
    portraitScoredRows,
    bioCoreCoverage: ratio(bioCoreCovered, bioCoreTotal),
    bioMajorContradictions: bioMajor,
    bioInventionRate: ratio(rowsWithBioInvention, rowCount)
  }

  const checks = {
    appearanceCoreCoverage: metrics.appearanceCoreCoverage >= fixture.gates.appearanceCoreCoverage,
    appearanceMajorContradictions:
      metrics.appearanceMajorContradictions <= fixture.gates.appearanceMajorContradictions,
    appearanceInventionRate: metrics.appearanceInventionRate <= fixture.gates.appearanceInventionRate,
    portraitUsableRate: metrics.portraitUsableRate >= fixture.gates.portraitUsableRate,
    bioCoreCoverage: metrics.bioCoreCoverage >= fixture.gates.bioCoreCoverage,
    bioMajorContradictions: metrics.bioMajorContradictions <= fixture.gates.bioMajorContradictions,
    bioInventionRate: metrics.bioInventionRate <= fixture.gates.bioInventionRate
  }

  return {
    fixture: { id: fixture.id, source: fixture.source },
    metrics,
    gate: { passed: Object.values(checks).every(Boolean), thresholds: fixture.gates, checks },
    characters: perCharacter
  }
}

/** OpenAI-compatible chat client, the same env the book-analysis LiteLLM route uses. */
export function createEnvCompleteChat(env = process.env) {
  const baseUrl = String(env.JUDGE_BASE_URL || env.LITELLM_BASE_URL || '').replace(/\/$/, '')
  const apiKey = env.JUDGE_API_KEY || env.LITELLM_API_KEY
  const model = env.JUDGE_MODEL || env.LITELLM_MODEL
  if (!baseUrl || !apiKey || !model) return null
  return async ({ messages }) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0 })
    })
    if (!response.ok) {
      throw new Error(`judge model failed: HTTP ${response.status} ${await response.text()}`)
    }
    const body = await response.json()
    return body?.choices?.[0]?.message?.content ?? ''
  }
}

export async function runJudge({ fixture, identityFixture, input, completeChat, onProgress }) {
  const tasks = buildJudgeTasks({ fixture, identityFixture, input })
  const verdicts = []
  for (const [index, task] of tasks.entries()) {
    onProgress?.({ index: index + 1, total: tasks.length, name: task.rowName })
    const raw = await completeChat({ messages: task.messages })
    verdicts.push({
      judgeId: task.judgeId,
      goldId: task.goldId,
      goldName: task.goldName,
      rowName: task.rowName,
      promptVersion: task.promptVersion,
      verdict: parseVerdict(raw, task.judgeId)
    })
  }
  return verdicts
}

function parseArguments(argv) {
  const result = { pretty: false, requirePass: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--fixture') result.fixturePath = argv[++index]
    else if (value === '--identity-fixture') result.identityPath = argv[++index]
    else if (value === '--input') result.inputPath = argv[++index]
    else if (value === '--verdicts') result.verdictsPath = argv[++index]
    else if (value === '--out') result.outPath = argv[++index]
    else if (value === '--prompts') result.promptsDir = argv[++index]
    else if (value === '--pretty') result.pretty = true
    else if (value === '--require-pass') result.requirePass = true
    else throw inputError(`unknown argument: ${value}`)
  }
  if (!result.fixturePath) throw inputError('--fixture is required')
  return result
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const fixture = await loadAppearanceBioFixture(options.fixturePath)

  if (options.promptsDir || !options.verdictsPath) {
    if (!options.inputPath) throw inputError('--input is required unless --verdicts is given')
  }

  let verdicts
  if (options.verdictsPath) {
    const recorded = JSON.parse(await readFile(options.verdictsPath, 'utf8'))
    verdicts = Array.isArray(recorded) ? recorded : recorded.verdicts
  } else {
    const [identityFixture, input] = await Promise.all([
      options.identityPath
        ? readFile(options.identityPath, 'utf8').then(JSON.parse)
        : Promise.resolve(null),
      readFile(options.inputPath, 'utf8').then(JSON.parse)
    ])

    if (options.promptsDir) {
      const tasks = buildJudgeTasks({ fixture, identityFixture, input })
      await mkdir(options.promptsDir, { recursive: true })
      for (const task of tasks) {
        await writeFile(
          path.join(options.promptsDir, `${task.judgeId}.json`),
          `${JSON.stringify(task, null, 2)}\n`
        )
      }
      process.stdout.write(`${tasks.length} prompts -> ${options.promptsDir}\n`)
      return
    }

    const completeChat = createEnvCompleteChat()
    if (!completeChat) {
      throw inputError(
        'no judge model configured: set JUDGE_BASE_URL/JUDGE_API_KEY/JUDGE_MODEL ' +
        '(or the LITELLM_* equivalents), or pass --verdicts with recorded verdicts'
      )
    }
    verdicts = await runJudge({
      fixture,
      identityFixture,
      input,
      completeChat,
      onProgress: ({ index, total, name }) =>
        process.stderr.write(`judging ${index}/${total}: ${name}\n`)
    })
    if (options.outPath) {
      await writeFile(options.outPath, `${JSON.stringify(verdicts, null, 2)}\n`)
    }
  }

  const report = scoreJudgeVerdicts({ fixture, verdicts })
  process.stdout.write(`${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`)
  if (options.requirePass && !report.gate.passed) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
