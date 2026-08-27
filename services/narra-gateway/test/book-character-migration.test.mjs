import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('published character cleanup trims only the canonical projection and stops omitted media work', async () => {
  const sql = await readFile(
    new URL('../migrations/020_limit_published_characters.sql', import.meta.url),
    'utf8'
  )
  assert.match(sql, /markup\.analysis_version = 'book-markup-v3'/)
  assert.match(sql, /ranking\.prominence_rank <= 20/)
  assert.match(sql, /ranking\.prominence_rank > 20/)
  assert.match(sql, /CHARACTER_NOT_SELECTED/)
  assert.match(sql, /DELETE FROM book_characters/)
  assert.doesNotMatch(sql, /UPDATE book_analysis_publications/)
  assert.doesNotMatch(sql, /DELETE FROM media_assets/)
})
