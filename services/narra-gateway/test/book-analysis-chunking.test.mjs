import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOOK_ANALYSIS_CHUNK_DEFAULTS,
  createStableBookChunks
} from '../book-analysis-chunking.mjs'

function fixture() {
  const first = Array.from({ length: 120 }, (_, index) =>
    `Абзац первой главы ${index}. Анна совершает поступок и отвечает собеседнику.`
  ).join('\n\n')
  const separator = '\n\n'
  const second = Array.from({ length: 110 }, (_, index) =>
    `Абзац второй главы ${index}. Борис наблюдает последствия события.`
  ).join('\n\n')
  const text = first + separator + second
  return {
    text,
    sections: [
      { key: 'chapter-1', title: 'Первая глава', startOffset: 0, endOffset: first.length + separator.length },
      { key: 'chapter-2', title: 'Вторая глава', startOffset: first.length + separator.length, endOffset: text.length }
    ]
  }
}

test('stable chunks cover every core character exactly once', () => {
  const input = fixture()
  const chunks = createStableBookChunks({ runId: 'run-1', ...input }, {
    targetChars: 1_200,
    minChars: 800,
    maxChars: 1_500,
    overlapChars: 150
  })
  assert.ok(chunks.length > 2)
  assert.equal(chunks[0].coreStartOffset, 0)
  assert.equal(chunks.at(-1).coreEndOffset, input.text.length)
  assert.equal(
    chunks.reduce((sum, chunk) => sum + chunk.coreEndOffset - chunk.coreStartOffset, 0),
    input.text.length
  )
  for (const [index, chunk] of chunks.entries()) {
    assert.equal(chunk.ordinal, index)
    assert.match(chunk.id, /^[0-9a-f-]{36}$/)
    assert.match(chunk.contentHash, /^[0-9a-f]{64}$/)
    assert.equal(
      chunk.metadata.contextByteEnd - chunk.metadata.contextByteStart,
      Buffer.byteLength(input.text.slice(chunk.contextStartOffset, chunk.contextEndOffset))
    )
    assert.ok(chunk.contextStartOffset <= chunk.coreStartOffset)
    assert.ok(chunk.contextEndOffset >= chunk.coreEndOffset)
    if (index > 0) assert.equal(chunks[index - 1].coreEndOffset, chunk.coreStartOffset)
  }
})

test('UTF-8 byte ranges stay aligned with UTF-16 text offsets', () => {
  const text = `${'🙂 Анна вошла.\n\n'.repeat(200)}Конец.`
  const chunks = createStableBookChunks({
    runId: 'unicode-run',
    text,
    sections: [{ key: 'document', startOffset: 0, endOffset: text.length }]
  }, {
    targetChars: 600,
    minChars: 400,
    maxChars: 800,
    overlapChars: 100
  })
  const bytes = Buffer.from(text)
  for (const chunk of chunks) {
    const range = bytes.subarray(
      chunk.metadata.contextByteStart,
      chunk.metadata.contextByteEnd
    ).toString('utf8')
    assert.equal(range, text.slice(chunk.contextStartOffset, chunk.contextEndOffset))
    assert.equal(range.includes('\uFFFD'), false)
  }
})

test('fallback boundaries never split a surrogate pair', () => {
  const text = '🙂'.repeat(40)
  const chunks = createStableBookChunks({
    runId: 'unicode-fallback-run',
    text,
    sections: [{ key: 'document', startOffset: 0, endOffset: text.length }]
  }, {
    targetChars: 9,
    minChars: 8,
    maxChars: 9,
    overlapChars: 2
  })
  const bytes = Buffer.from(text)
  for (const chunk of chunks) {
    assert.equal(chunk.coreStartOffset % 2, 0)
    assert.equal(chunk.coreEndOffset % 2, 0)
    assert.equal(
      bytes.subarray(
        chunk.metadata.contextByteStart,
        chunk.metadata.contextByteEnd
      ).toString('utf8'),
      text.slice(chunk.contextStartOffset, chunk.contextEndOffset)
    )
  }
})

test('chunk identities and boundaries are deterministic', () => {
  const input = fixture()
  const options = { targetChars: 1_100, minChars: 700, maxChars: 1_400, overlapChars: 120 }
  const first = createStableBookChunks({ runId: 'run-2', ...input }, options)
  const second = createStableBookChunks({ runId: 'run-2', ...input }, options)
  assert.deepEqual(second, first)
  const otherRun = createStableBookChunks({ runId: 'run-3', ...input }, options)
  assert.deepEqual(
    otherRun.map(({ coreStartOffset, coreEndOffset }) => [coreStartOffset, coreEndOffset]),
    first.map(({ coreStartOffset, coreEndOffset }) => [coreStartOffset, coreEndOffset])
  )
  assert.notEqual(otherRun[0].id, first[0].id)
})

test('chunking rejects a section map with gaps', () => {
  assert.throws(() => createStableBookChunks({
    runId: 'run-4',
    text: 'abcdefghij',
    sections: [
      { key: 'one', startOffset: 0, endOffset: 4 },
      { key: 'two', startOffset: 5, endOffset: 10 }
    ]
  }, {
    targetChars: 5,
    minChars: 4,
    maxChars: 6,
    overlapChars: 1
  }), /contiguously/)
})

test('default chunks keep a short book inside the scan coverage budget', () => {
  const text = 'Сюжетный абзац с Евгением и Парашей.\n\n'.repeat(390).slice(0, 15_805)
  const chunks = createStableBookChunks({
    runId: 'short-book-coverage-run',
    text,
    sections: [{ key: 'book', startOffset: 0, endOffset: text.length }]
  })

  assert.deepEqual(BOOK_ANALYSIS_CHUNK_DEFAULTS, {
    targetChars: 4_000,
    minChars: 2_500,
    maxChars: 5_000,
    overlapChars: 500
  })
  assert.ok(chunks.length >= 3)
  assert.ok(chunks.every((chunk) =>
    chunk.coreEndOffset - chunk.coreStartOffset <= BOOK_ANALYSIS_CHUNK_DEFAULTS.maxChars
  ))
})
