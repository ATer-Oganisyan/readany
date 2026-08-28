import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_TTS_MARKUP_VERSION,
  assembleBookTtsScript,
  createBookTtsMarkupRequests,
  createBookTtsSectionDrafts,
  normalizeBookTtsAssignments,
  normalizeBookTtsScript
} from '../book-tts-markup.mjs'

const TEXT = 'Глава первая\n\n— Привет, — сказал Иван. — Как дела?\n\nНаступила тишина.'
const SECTION = {
  key: 'chapter-1', title: 'Глава первая', index: 0,
  startOffset: 0, endOffset: TEXT.length
}
const CHARACTERS = [{
  characterKey: 'character:ivan', name: 'Иван', fullName: 'Иван', aliases: []
}]

test('TTS draft keeps exact source coverage and separates dialogue from author remarks', () => {
  const [draft] = createBookTtsSectionDrafts({ text: TEXT, sections: [SECTION] })
  assert.equal(draft.atoms.map(({ text }) => text).join(''), TEXT)

  const speech = draft.atoms.filter(({ kind }) => kind === 'speech')
  const narration = draft.atoms.filter(({ kind }) => kind === 'narration')
  assert.deepEqual(speech.map(({ text }) => text.trim()), ['— Привет,', '— Как дела?'])
  assert.ok(narration.some(({ text }) => text.includes('сказал Иван.')))
})

test('TTS draft separates English quoted speech without changing source text', () => {
  const text = 'John stopped. "Hello," he said. "How are you?" The room was quiet.'
  const [draft] = createBookTtsSectionDrafts({
    text,
    sections: [{ key: 'chapter-1', title: 'Chapter 1', index: 0, startOffset: 0, endOffset: text.length }]
  })
  assert.equal(draft.atoms.map(({ text: atomText }) => atomText).join(''), text)
  assert.deepEqual(
    draft.atoms.filter(({ kind }) => kind === 'speech').map(({ text: atomText }) => atomText),
    ['"Hello,"', '"How are you?"']
  )
})

test('TTS requests send numbered speech atoms and a closed canonical character roster', () => {
  const drafts = createBookTtsSectionDrafts({ text: TEXT, sections: [SECTION] })
  const requests = createBookTtsMarkupRequests({
    bookEditionId: 'book-1', sourcePublicationId: 'publication-1',
    normalizedTextHash: 'a'.repeat(64), drafts, characters: CHARACTERS,
    maxCoreChars: 5_000, contextChars: 500
  })
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].characters, CHARACTERS)
  assert.deepEqual(
    requests[0].coreAtoms.map(({ atomId, kind }) => [atomId, kind]),
    drafts[0].atoms.filter(({ kind }) => kind === 'speech').map(({ id, kind }) => [id, kind])
  )
  assert.equal(requests[0].markupVersion, BOOK_TTS_MARKUP_VERSION)
})

test('TTS requests clip very large narration to the configured attribution context', () => {
  const text = `${'A'.repeat(50_000)}\n\n"Hello."\n\n${'B'.repeat(50_000)}`
  const drafts = createBookTtsSectionDrafts({
    text,
    sections: [{ key: 'chapter-1', title: '', index: 0, startOffset: 0, endOffset: text.length }]
  })
  const [request] = createBookTtsMarkupRequests({
    bookEditionId: 'book-1', sourcePublicationId: 'publication-1',
    normalizedTextHash: 'a'.repeat(64), drafts, characters: CHARACTERS,
    maxCoreChars: 5_000, contextChars: 500
  })
  assert.ok(Math.max(...drafts[0].atoms.map((atom) => atom.text.length)) <= 5_000)
  assert.ok(request.contextAtoms.reduce((sum, atom) => sum + atom.text.length, 0) <= 1_008)
})

test('LLM assignments cannot invent atoms or characters', () => {
  const [draft] = createBookTtsSectionDrafts({ text: TEXT, sections: [SECTION] })
  const speechIds = draft.atoms.filter(({ kind }) => kind === 'speech').map(({ id }) => id)
  assert.deepEqual(normalizeBookTtsAssignments({
    assignments: speechIds.map((atomId) => ({
      atomId, characterKey: 'character:ivan', confidence: 0.91
    }))
  }, { coreAtoms: draft.atoms, characters: CHARACTERS }), speechIds.map((atomId) => ({
    atomId, characterKey: 'character:ivan', confidence: 0.91
  })))

  assert.throws(() => normalizeBookTtsAssignments({
    assignments: [{ atomId: 'invented', characterKey: 'character:ivan', confidence: 1 }]
  }, { coreAtoms: draft.atoms, characters: CHARACTERS }), /unknown atom/)
  assert.throws(() => normalizeBookTtsAssignments({
    assignments: [{ atomId: speechIds[0], characterKey: 'character:ghost', confidence: 1 }]
  }, { coreAtoms: draft.atoms, characters: CHARACTERS }), /unknown character/)
})

test('published TTS script is an additive exact source-bound artifact', () => {
  const drafts = createBookTtsSectionDrafts({ text: TEXT, sections: [SECTION] })
  const assignments = drafts[0].atoms
    .filter(({ kind }) => kind === 'speech')
    .map(({ id }) => ({ atomId: id, characterKey: 'character:ivan', confidence: 0.95 }))
  const script = assembleBookTtsScript({
    sourceText: TEXT,
    sourcePublicationId: '11111111-1111-4111-8111-111111111111',
    sourceMarkupContentHash: 'b'.repeat(64),
    normalizedTextHash: 'a'.repeat(64),
    drafts,
    assignments
  })
  const normalized = normalizeBookTtsScript(script, TEXT)
  assert.equal(normalized.analysisVersion, BOOK_TTS_MARKUP_VERSION)
  assert.equal(normalized.sourcePublicationId, '11111111-1111-4111-8111-111111111111')
  assert.equal(normalized.sections[0].segments.map(({ text }) => text).join(''), TEXT)
  assert.deepEqual(
    normalized.sections[0].segments.filter(({ kind }) => kind === 'speech')
      .map(({ characterKey }) => characterKey),
    ['character:ivan', 'character:ivan']
  )
})
