/**
 * Операторский прогрев сцен.
 *
 * Нужен для одного случая: первую пачку кто-то должен поставить, а книга могла
 * стоять с тех пор, как очередь сцен чистили руками — слоты остались `failed`,
 * и фоновый подогрев их не трогает. Приоритет 70 и выше это и есть «оператор
 * просит»: с ним провалившийся слот внутри фронтира возвращается в очередь.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../books/warm-book-scenes.mjs', import.meta.url), 'utf8')

test('the command takes editions, an optional reader offset and nothing else', () => {
  const parseArgs = new Function(`${source.slice(
    source.indexOf('const UUID'),
    source.indexOf('const { bookEditionIds')
  )}; return parseArgs`)()

  const EDITION = '11111111-1111-4111-8111-111111111111'
  assert.deepEqual(parseArgs(['--edition', EDITION]), {
    bookEditionIds: [EDITION], readerTextOffset: null, priority: 70, mode: 'reader'
  })
  assert.deepEqual(
    parseArgs(['--edition', EDITION, '--reader-offset', '5754', '--priority', '45']),
    { bookEditionIds: [EDITION], readerTextOffset: 5754, priority: 45, mode: 'reader' }
  )
  assert.equal(parseArgs(['--edition', EDITION, '--mode', 'book']).mode, 'book')
  assert.throws(() => parseArgs(['--edition', EDITION, '--mode', 'всё']), { code: 'USAGE' })
  assert.throws(() => parseArgs([]), { code: 'USAGE' })
  assert.throws(() => parseArgs(['--edition', 'not-a-uuid']), { code: 'USAGE' })
  assert.throws(() => parseArgs(['--edition', EDITION, '--reader-offset', '-1']), { code: 'USAGE' })
  assert.throws(() => parseArgs(['--all']), { code: 'USAGE' })
})

test('the command decides nothing about the frontier itself', () => {
  // Докуда делать сцены, решает `ensureBookScenesThrough` по режиму и позиции
  // читателя. Команда только зовёт его — иначе ручной прогрев обходил бы
  // ровно тот предел, из-за отсутствия которого очередь и переполнилась.
  assert.match(source, /repository\.ensureBookScenesThrough\(/)
  assert.doesNotMatch(source, /INSERT\s+INTO\s+generation_jobs/i)
  assert.doesNotMatch(source, /UPDATE\s+generation_jobs/i)
  // Позиция берётся самая дальняя: пачка общая на книгу.
  assert.match(source, /MAX\(text_offset\)/)
})
