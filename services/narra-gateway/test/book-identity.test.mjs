import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_IDENTITY_VERSION,
  bookIdentityTargetVersion,
  normalizeBookDisplayIdentity
} from '../book-identity.mjs'

test('book identity removes only explicit bibliographic noise', () => {
  assert.deepEqual(normalizeBookDisplayIdentity({
    title: '  Мертвое озеро (Часть первая) [1] ',
    author: ' Николай Некрасов (1821—1877) '
  }), {
    title: 'Мертвое озеро',
    author: 'Николай Некрасов'
  })
  assert.equal(
    normalizeBookDisplayIdentity({ title: 'Что делать?' }).title,
    'Что делать?'
  )
  assert.equal(
    normalizeBookDisplayIdentity({ title: 'Росла́влев, или Русские в 1812 году' }).title,
    'Росла́влев, или Русские в 1812 году'
  )
})

test('book identity target changes with immutable source or raw metadata', () => {
  const input = { contentSha256: 'a'.repeat(64), title: 'Книга', author: 'Автор' }
  const target = bookIdentityTargetVersion(input)
  assert.match(target, new RegExp(`^${BOOK_IDENTITY_VERSION}-[0-9a-f]{16}$`))
  assert.notEqual(target, bookIdentityTargetVersion({ ...input, title: 'Другая книга' }))
  assert.notEqual(target, bookIdentityTargetVersion({ ...input, contentSha256: 'b'.repeat(64) }))
})
