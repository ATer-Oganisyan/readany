/**
 * Поимённый список изданий для конвейера карточек.
 *
 * Раскатка идёт канарейкой на нескольких каталожных книгах, а не флагом «всем
 * новым импортам»: конвейер меняет то, что видит читатель, и откат стоит
 * восстановления данных. Отсюда два свойства, которые тест и держит: включить
 * книгу можно только назвав её, и опечатка в идентификаторе обязана падать при
 * старте, а не тихо превращаться в «книга не включена».
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_ANALYSIS_PIPELINE_CARDS,
  BOOK_ANALYSIS_PIPELINE_NARRA,
  bookAnalysisAssignedPipelineForEdition,
  bookAnalysisCardsEditionsFromEnv,
  bookAnalysisPipelineForEdition
} from '../analysis/book-analysis-pipeline.mjs'

const CRIME = 'bef16434-1e57-4088-a9e0-aa3883797e1f'
const GRANT = 'b704994b-d1ef-4779-8c09-afb454c55c8e'
const OTHER = '11111111-1111-4111-8111-111111111111'

test('only the named editions get the cards pipeline', () => {
  const env = { BOOK_ANALYSIS_CARDS_EDITIONS: `${CRIME},${GRANT}` }
  assert.equal(bookAnalysisPipelineForEdition(CRIME, env), BOOK_ANALYSIS_PIPELINE_CARDS)
  assert.equal(bookAnalysisPipelineForEdition(GRANT, env), BOOK_ANALYSIS_PIPELINE_CARDS)
  assert.equal(bookAnalysisPipelineForEdition(OTHER, env), BOOK_ANALYSIS_PIPELINE_NARRA)
  assert.equal(bookAnalysisPipelineForEdition(null, env), BOOK_ANALYSIS_PIPELINE_NARRA)
})

test('an empty list changes nothing', () => {
  assert.equal(bookAnalysisPipelineForEdition(CRIME, {}), BOOK_ANALYSIS_PIPELINE_NARRA)
  assert.deepEqual([...bookAnalysisCardsEditionsFromEnv({})], [])
  assert.deepEqual([...bookAnalysisCardsEditionsFromEnv({ BOOK_ANALYSIS_CARDS_EDITIONS: '  ' })], [])
})

test('the list is case-insensitive and tolerates spaces and newlines', () => {
  const env = { BOOK_ANALYSIS_CARDS_EDITIONS: `\n  ${CRIME.toUpperCase()} ,\n${GRANT}\n` }
  assert.equal(bookAnalysisPipelineForEdition(CRIME, env), BOOK_ANALYSIS_PIPELINE_CARDS)
  assert.equal(bookAnalysisPipelineForEdition(GRANT.toUpperCase(), env), BOOK_ANALYSIS_PIPELINE_CARDS)
})

test('a typo in an edition id fails loudly instead of quietly doing nothing', () => {
  // Оператор, опечатавшийся в идентификаторе, должен узнать об этом при старте,
  // а не по отсутствию эффекта на книге, которую он собирался включить.
  assert.throws(
    () => bookAnalysisCardsEditionsFromEnv({ BOOK_ANALYSIS_CARDS_EDITIONS: `${CRIME},не-uuid` }),
    { code: 'BOOK_ANALYSIS_CARDS_EDITIONS_INVALID' }
  )
})

test('the list cannot take a pipeline away, only assign cards', () => {
  // Снять конвейер, заданный глобально, список не может: это делается той же
  // настройкой, которой он задан.
  const env = { BOOK_ANALYSIS_PIPELINE: 'external', BOOK_ANALYSIS_CARDS_EDITIONS: CRIME }
  assert.equal(bookAnalysisPipelineForEdition(CRIME, env), BOOK_ANALYSIS_PIPELINE_CARDS)
  assert.equal(bookAnalysisPipelineForEdition(OTHER, env), 'external')
})

test('an assignment is distinguishable from the default pipeline', () => {
  // Репозиторию мало ответа «narra»: при перезапуске он наследует конвейер
  // предыдущего прогона, и ему нужно знать, названа книга поимённо или просто
  // не названа. Назначение сильнее наследования, настройка по умолчанию — нет.
  const env = { BOOK_ANALYSIS_CARDS_EDITIONS: CRIME }
  assert.equal(bookAnalysisAssignedPipelineForEdition(CRIME, env), BOOK_ANALYSIS_PIPELINE_CARDS)
  assert.equal(bookAnalysisAssignedPipelineForEdition(OTHER, env), null)
  assert.equal(bookAnalysisAssignedPipelineForEdition(null, env), null)
  assert.equal(
    bookAnalysisAssignedPipelineForEdition(OTHER, { BOOK_ANALYSIS_PIPELINE: 'external' }),
    null
  )
  assert.equal(
    bookAnalysisPipelineForEdition(OTHER, { BOOK_ANALYSIS_PIPELINE: 'external' }),
    'external'
  )
})
