/**
 * Согласие двух судей на одном и том же входе.
 *
 * Бенчмарк PR #87 снят судьёй-Opus вручную и сам это отмечал как ограничение:
 * числа судьи привязаны к судье, и прежде чем ставить их гейтом в CI, надо
 * прогнать штатной моделью и сверить. Прогон состоялся — `deepseek-v4-pro`
 * через OpenAI-совместимый роут, тот же `character-card-judge-v1`, temperature 0.
 *
 * Вывод, который этот тест закрепляет: метрики *покрытия* воспроизводятся между
 * судьями, а метрики *выдумок и противоречий* — нет. Значит гейтом в CI могут
 * быть только первые; вторые остаются диагностикой, привязанной к конкретному
 * судье. Тест сравнивает две замороженные выдачи, поэтому сети не требует.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  loadAppearanceBioFixture,
  scoreJudgeVerdicts
} from '../evaluation/judge-character-cards.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const evaluation = path.join(directory, '..', 'evaluation')

const BOOKS = ['evgeniy-onegin', 'deti-kapitana-granta']

/** Метрики, воспроизводимые между судьями: годятся в гейт. */
const STABLE_METRICS = ['appearanceCoreCoverage', 'portraitUsableRate']
/** Метрики, между судьями расходящиеся: диагностика, не гейт. */
const JUDGE_DEPENDENT_METRICS = [
  'appearanceInventionRate',
  'bioInventionRate',
  'bioMajorContradictions'
]

async function scored(book) {
  const fixture = await loadAppearanceBioFixture(
    path.join(evaluation, 'cards', `${book}-ru-appearance-bio-v1.json`)
  )
  const load = async (suffix) => JSON.parse(await readFile(
    path.join(directory, 'fixtures', `${book}-v3-judge-verdicts${suffix}.json`),
    'utf8'
  ))
  return {
    opus: scoreJudgeVerdicts({ fixture, verdicts: await load('') }),
    deepseek: scoreJudgeVerdicts({ fixture, verdicts: await load('-deepseek-v4-pro') })
  }
}

test('both judges score the same rows of the same prompt version', async () => {
  for (const book of BOOKS) {
    const { opus, deepseek } = await scored(book)
    assert.equal(
      deepseek.metrics.judgedRows,
      opus.metrics.judgedRows,
      `${book}: судьи оценили разное число строк`
    )
    assert.equal(deepseek.metrics.judgedCharacters, opus.metrics.judgedCharacters)
  }
})

test('appearance coverage and portrait usability reproduce across judges', async () => {
  for (const book of BOOKS) {
    const { opus, deepseek } = await scored(book)
    for (const metric of STABLE_METRICS) {
      const left = opus.metrics[metric]
      const right = deepseek.metrics[metric]
      assert.ok(
        Math.abs(left - right) < 0.001,
        `${book}.${metric}: ${left} против ${right} — метрика перестала быть судья-независимой`
      )
    }
  }
})

test('per-character appearance coverage is identical for every character', async () => {
  // Это и есть основание считать покрытие внешности пригодным для гейта: судьи
  // сходятся не в среднем, а по каждому персонажу отдельно.
  for (const book of BOOKS) {
    const { opus, deepseek } = await scored(book)
    const right = new Map(deepseek.characters.map((row) => [row.goldId, row]))
    for (const row of opus.characters) {
      const other = right.get(row.goldId)
      assert.ok(other, `${book}: судья DeepSeek не оценил ${row.goldId}`)
      assert.deepEqual(
        [row.appearance.coreTotal, row.appearance.coreCovered],
        [other.appearance.coreTotal, other.appearance.coreCovered],
        `${book}.${row.goldId}: расхождение по покрытию внешности`
      )
    }
  }
})

test('invention and contradiction rates are judge-dependent and must not be gates', async () => {
  // Утверждение намеренно фиксирует расхождение, а не согласие: если судьи
  // однажды сойдутся и здесь, тест упадёт и заставит перечитать вывод, вместо
  // того чтобы тихо оставить в документе устаревшее ограничение.
  const divergent = []
  for (const book of BOOKS) {
    const { opus, deepseek } = await scored(book)
    for (const metric of JUDGE_DEPENDENT_METRICS) {
      if (Math.abs(opus.metrics[metric] - deepseek.metrics[metric]) >= 0.001) {
        divergent.push(`${book}.${metric}`)
      }
    }
  }
  assert.ok(
    divergent.length >= 4,
    `ожидалось расхождение судей по метрикам выдумок и противоречий, найдено: ${divergent.join(', ')}`
  )
})

test('both judges agree the gate fails and on which characters are broken', async () => {
  for (const book of BOOKS) {
    const { opus, deepseek } = await scored(book)
    assert.equal(opus.gate.passed, false)
    assert.equal(deepseek.gate.passed, false)
    const zeroCoverage = (report) => report.characters
      .filter((row) => row.appearance.coreTotal > 0 && row.appearance.coreCovered === 0)
      .map((row) => row.goldId)
      .sort()
    assert.deepEqual(
      zeroCoverage(deepseek),
      zeroCoverage(opus),
      `${book}: судьи назвали разных персонажей с нулевым покрытием внешности`
    )
  }
})
