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
  bookAnalysisPipelineForEdition,
  bookAnalysisPipelineForScope
} from '../analysis/book-analysis-pipeline.mjs'

const CRIME = 'bef16434-1e57-4088-a9e0-aa3883797e1f'
const GRANT = 'b704994b-d1ef-4779-8c09-afb454c55c8e'
const OTHER = '11111111-1111-4111-8111-111111111111'

test('only the named editions get the cards pipeline', () => {
  const env = { BOOK_ANALYSIS_CARDS_EDITIONS: `${CRIME},${GRANT}` }
  assert.equal(bookAnalysisPipelineForEdition(CRIME, env), BOOK_ANALYSIS_PIPELINE_CARDS)
  assert.equal(bookAnalysisPipelineForEdition(GRANT, env), BOOK_ANALYSIS_PIPELINE_CARDS)
  // Умолчание — карточки; прежнее поведение возвращается настройкой.
  const narraDefault = { ...env, BOOK_ANALYSIS_PIPELINE: 'narra' }
  assert.equal(bookAnalysisPipelineForEdition(OTHER, narraDefault), BOOK_ANALYSIS_PIPELINE_NARRA)
  assert.equal(bookAnalysisPipelineForEdition(OTHER, env), BOOK_ANALYSIS_PIPELINE_CARDS)
  assert.equal(bookAnalysisPipelineForEdition(null, env), BOOK_ANALYSIS_PIPELINE_CARDS)
})

test('an empty list changes nothing', () => {
  // Пустой список ничего не назначает: книга идёт тем конвейером, который задан
  // по умолчанию, — и это видно по настройке, а не по списку.
  assert.equal(
    bookAnalysisPipelineForEdition(CRIME, { BOOK_ANALYSIS_PIPELINE: 'narra' }),
    BOOK_ANALYSIS_PIPELINE_NARRA
  )
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

test('приватная книга идёт на карточки, каталожная остаётся на прежнем конвейере', () => {
  // Приватная книга — загрузка живого человека: окна карточек открываются за
  // ним, и разметка публикуется по мере их готовности. Каталог разбирается один
  // раз на всех и целиком, поэтому правило про область видимости, а не про
  // «новые книги».
  assert.equal(bookAnalysisPipelineForScope('private', {}), BOOK_ANALYSIS_PIPELINE_CARDS)
  assert.equal(bookAnalysisPipelineForScope('catalog', {}), null)
  assert.equal(bookAnalysisPipelineForScope(null, {}), null)
  assert.equal(
    bookAnalysisAssignedPipelineForEdition(OTHER, {}, 'private'),
    BOOK_ANALYSIS_PIPELINE_CARDS
  )
  assert.equal(bookAnalysisAssignedPipelineForEdition(OTHER, {}, 'catalog'), null)
})

test('приватные книги возвращаются к общей настройке одним словом', () => {
  // Путь отката без выкладки кода: настройка сильнее умолчания в обе стороны.
  const off = { BOOK_ANALYSIS_PIPELINE_PRIVATE: 'none' }
  assert.equal(bookAnalysisPipelineForScope('private', off), null)
  assert.equal(
    bookAnalysisPipelineForEdition(OTHER, { ...off, BOOK_ANALYSIS_PIPELINE: 'narra' }),
    BOOK_ANALYSIS_PIPELINE_NARRA
  )
  assert.equal(
    bookAnalysisPipelineForScope('private', { BOOK_ANALYSIS_PIPELINE_PRIVATE: 'narra' }),
    BOOK_ANALYSIS_PIPELINE_NARRA
  )
  assert.throws(
    () => bookAnalysisPipelineForScope('private', { BOOK_ANALYSIS_PIPELINE_PRIVATE: 'выдумка' }),
    /BOOK_ANALYSIS_PIPELINE_PRIVATE/
  )
})

test('поимённый список сильнее правила по области видимости', () => {
  const env = { BOOK_ANALYSIS_CARDS_EDITIONS: CRIME, BOOK_ANALYSIS_PIPELINE_PRIVATE: 'none' }
  assert.equal(
    bookAnalysisAssignedPipelineForEdition(CRIME, env, 'private'),
    BOOK_ANALYSIS_PIPELINE_CARDS
  )
})
