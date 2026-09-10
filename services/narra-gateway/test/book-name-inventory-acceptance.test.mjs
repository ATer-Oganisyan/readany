/**
 * Приёмка инвентаря имён на frozen identity fixtures.
 *
 * Тексты книг в репозиторий не коммитятся: это чужие произведения, и их
 * происхождение зафиксировано хэшами в самих фикстурах. Прогон требует кэша:
 *
 *   NARRA_IDENTITY_BOOK_DIR=/путь node evaluation/fetch-identity-books.mjs
 *   NARRA_IDENTITY_BOOK_DIR=/путь node --test test/book-name-inventory-acceptance.test.mjs
 *
 * Без кэша тест пропускается, а не выдумывает данные: зелёный прогон без книг
 * означал бы, что метрика не измерена, и хуже этого только красный.
 */

import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import test from 'node:test'
import {
  defaultIdentityBookDirectory,
  listIdentityFixturePaths
} from '../evaluation/fetch-identity-books.mjs'
import {
  INVENTORY_GATES,
  inventoryGateChecks,
  scoreNameInventoryFixture
} from '../evaluation/score-name-inventory.mjs'

const outputDirectory = defaultIdentityBookDirectory()

/**
 * Зафиксированные значения текущего прогона. Гейт по полноте — из work order'а;
 * остальные числа охраняют от регресса именно то, что измерено, и меняются
 * только вместе с осознанным изменением правил инвентаря.
 */
const EXPECTED = new Map(Object.entries({
  'alice-wonderland-pdnc-v1': { significantRecall: 0.909, anyGoldPrecision: 0.81 },
  'anne-green-gables-pdnc-v1': { significantRecall: 1, anyGoldPrecision: 0.49 },
  'dorian-gray-pdnc-v1': { significantRecall: 1, anyGoldPrecision: 0.51 },
  'invisible-man-pdnc-v1': { significantRecall: 0.9, anyGoldPrecision: 0.53 },
  'little-women-litbank-chapter-one-v1': { significantRecall: 0.83, anyGoldPrecision: 1 },
  'pride-prejudice-bookcoref-v1': { significantRecall: 1, anyGoldPrecision: 0.65 },
  'sense-sensibility-pdnc-v1': { significantRecall: 0.91, anyGoldPrecision: 0.54 },
  'siddhartha-bookcoref-v1': { significantRecall: 0.75, anyGoldPrecision: 0.85 }
}))

/**
 * Книги, на которых полнота ниже гейта по устройству данных, а не из-за
 * инвентаря: обе недостающие идентичности — безымянные. У LitBank это «Father»,
 * присутствующий во фрагменте только упоминанием, у BOOKCOREF — «Young
 * Siddhartha» и «Siddhartha's Father», отдельные цепочки кореференции без
 * собственного имени. Частотный проход по именам их найти не может; это риск №1
 * work order'а, и закрывается он не порогом, а отдельным решением.
 */
const UNNAMED_IDENTITY_BOOKS = new Set([
  'little-women-litbank-chapter-one-v1',
  'siddhartha-bookcoref-v1'
])

async function scoreAll() {
  const results = []
  for (const fixturePath of await listIdentityFixturePaths()) {
    results.push(await scoreNameInventoryFixture({ fixturePath, outputDirectory }))
  }
  return results
}

/**
 * Пропуск определяется наличием кэша текстов, а не результатом прогона: тест,
 * который зеленеет на пустом каталоге, сообщает «всё хорошо» там, где метрика
 * просто не считалась.
 */
const skip = await (async () => {
  let names = []
  try {
    names = await readdir(outputDirectory)
  } catch {
    return `нет каталога с текстами книг: ${outputDirectory}; ` +
      'запустите evaluation/fetch-identity-books.mjs'
  }
  const cached = names.filter((name) => name.endsWith('.txt')).length
  return cached >= 8
    ? false
    : `в кэше ${cached} из 8 текстов (${outputDirectory}); ` +
      'запустите evaluation/fetch-identity-books.mjs'
})()

test('the deterministic inventory meets its recall gate on every frozen fixture', {
  skip
}, async () => {
  const scored = (await scoreAll()).filter(({ status }) => status === 'scored')
  assert.equal(
    scored.length,
    8,
    `ожидались все восемь англоязычных фикстур, посчитано ${scored.length}; ` +
    'русские фикстуры каталога текста в открытом источнике не имеют'
  )
  for (const result of scored) {
    const checks = inventoryGateChecks(result)
    const expected = EXPECTED.get(result.id)
    assert.ok(expected, `у фикстуры ${result.id} нет зафиксированного ожидания`)
    if (!UNNAMED_IDENTITY_BOOKS.has(result.id)) {
      assert.ok(
        checks.significantRecall,
        `${result.id}: полнота по значимым ${result.identity.significant.recall} ` +
        `ниже гейта ${INVENTORY_GATES.significantRecall}`
      )
    }
    assert.ok(
      result.identity.significant.recall >= expected.significantRecall - 0.01,
      `${result.id}: полнота упала до ${result.identity.significant.recall}, ` +
      `зафиксировано ${expected.significantRecall}`
    )
    assert.ok(
      result.identity.full.precision >= expected.anyGoldPrecision - 0.01,
      `${result.id}: точность упала до ${result.identity.full.precision}, ` +
      `зафиксировано ${expected.anyGoldPrecision}`
    )
  }
})

test('no frozen fixture produces a critical merge of two gold identities', {
  skip
}, async () => {
  const scored = (await scoreAll()).filter(({ status }) => status === 'scored')
  assert.equal(scored.length, 8)
  for (const result of scored) {
    assert.equal(
      result.identity.full.mergeRows,
      0,
      `${result.id}: строка склеила двух gold-персонажей — ` +
      JSON.stringify(result.identity.classifications.merges)
    )
  }
})

test('the backstop tier loses fewer significant identities than the significant tier', {
  skip
}, async () => {
  const scored = (await scoreAll()).filter(({ status }) => status === 'scored')
  assert.equal(scored.length, 8)
  for (const result of scored) {
    assert.ok(
      result.backstop.significantRecall >= result.identity.significant.recall,
      `${result.id}: backstop не полнее значимого яруса`
    )
    assert.ok(
      result.backstop.rosterCount >= result.identity.input.rosterCount,
      `${result.id}: backstop меньше значимого яруса`
    )
  }
})
