/**
 * Ручное продвижение цепочки окон.
 *
 * Команда нужна для одного случая: книга встала, а сдвинуть её нечем —
 * перезапуск прогона карточек возвращает тот же прогон, потому что он всё ещё
 * `running`. Проверяем, что она разбирает только то, что обещает: набор
 * изданий, каждое — UUID. Ошибиться здесь дорого: команда ходит в продовую
 * очередь.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../books/advance-card-windows.mjs', import.meta.url), 'utf8')

test('the command takes editions and nothing else', async () => {
  const parseArgs = new Function(`${source.slice(
    source.indexOf('const UUID'),
    source.indexOf('const editions =')
  )}; return parseArgs`)()

  const EDITION = '11111111-1111-4111-8111-111111111111'
  const OTHER = '22222222-2222-4222-8222-222222222222'
  assert.deepEqual(parseArgs(['--edition', EDITION]), [EDITION])
  assert.deepEqual(
    parseArgs(['--edition', EDITION.toUpperCase(), '--edition', OTHER, '--edition', EDITION]),
    [EDITION, OTHER]
  )
  assert.throws(() => parseArgs([]), { code: 'USAGE' })
  assert.throws(() => parseArgs(['--edition']), { code: 'USAGE' })
  assert.throws(() => parseArgs(['--edition', 'not-a-uuid']), { code: 'USAGE' })
  assert.throws(() => parseArgs(['--all']), { code: 'USAGE' })
})

test('the command decides nothing on its own', () => {
  // Правила ставит цепочка: предыдущее окно закрыто, состав книги подтверждён,
  // читатель не позади. Команда лишь зовёт её — иначе ручной сдвиг обходил бы
  // те самые предохранители, ради которых цепочка и написана.
  assert.match(source, /repository\.advanceCardWindows\(\{ runId, bookEditionId \}\)/)
  assert.doesNotMatch(source, /UPDATE\s+book_card_windows/i)
  assert.doesNotMatch(source, /INSERT\s+INTO\s+generation_jobs/i)
  // Берётся прогон карточек, а не любой последний: у прогона прежнего
  // конвейера окон нет вовсе.
  assert.match(source, /pipeline_id = 'cards'/)
})
