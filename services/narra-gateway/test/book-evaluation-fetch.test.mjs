import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalizeGutenbergText } from '../evaluation/fetch-books.mjs'

test('evaluation canonicalizer removes Gutenberg metadata and normalizes line endings', () => {
  const source = [
    'metadata',
    '*** START OF THE PROJECT GUTENBERG EBOOK TEST ***',
    '',
    'Chapter 1',
    '',
    'Alice appeared.',
    '',
    '*** END OF THE PROJECT GUTENBERG EBOOK TEST ***',
    'license'
  ].join('\r\n')
  assert.equal(canonicalizeGutenbergText(source), 'Chapter 1\n\nAlice appeared.\n')
})

test('evaluation canonicalizer rejects a source without frozen body markers', () => {
  assert.throws(
    () => canonicalizeGutenbergText('Alice appeared.'),
    /body markers were not found/
  )
})
