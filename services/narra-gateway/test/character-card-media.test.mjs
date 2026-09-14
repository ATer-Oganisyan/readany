import assert from 'node:assert/strict'
import test from 'node:test'
import { REQUIRED_CHARACTER_MEDIA } from '../books/book-markup.mjs'
import {
  CARD_MEDIA_PRIORITY,
  characterCardMediaPriority
} from '../analysis/book-character-card.mjs'
import {
  characterCardProjection,
  validateCharacterCard
} from '../analysis/book-character-card-contract.mjs'
import { normalizeCharacterBundleInput } from '../generation/generation-worker.mjs'
import { buildCharacterPortraitPrompt } from '../generation/character-portrait-prompt.mjs'
import { normalizeBundleRequest } from '../generation/internal-generation-contracts.mjs'
import { createPostgresBookMarkupRepository } from '../books/postgres-book-markup-repository.mjs'

const HASH = 'a'.repeat(64)

function scriptedPool(scripts) {
  const queries = []
  const client = {
    async query(sql, params) {
      queries.push({ sql, params, transaction: true })
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }
      return scripts.shift()?.(sql, params) ?? { rows: [] }
    },
    release() {}
  }
  return {
    queries,
    async connect() { return client },
    async query(sql, params) {
      queries.push({ sql, params, transaction: false })
      return scripts.shift()?.(sql, params) ?? { rows: [] }
    }
  }
}

function card(overrides = {}) {
  return validateCharacterCard({
    contractVersion: 'character-card-v1',
    characterKey: 'char:elizabeth-bennet',
    name: 'Элизабет',
    fullName: 'Элизабет Беннет',
    aliases: ['Лиззи'],
    firstMentionTextOffset: 8_132,
    cardWindow: { startOffset: 0, endOffset: 61_240, chapterIndexes: [0, 1] },
    mentionCount: 2_476,
    mentionCountInWindow: 214,
    traits: [{ value: 'наблюдательная', fragmentIds: ['frag:a'], confidence: 0.9 }],
    bio: { value: 'Элизабет — вторая из пяти дочерей семьи Беннет.', fragmentIds: ['frag:a'] },
    role: { value: 'вторая из пяти дочерей семьи Беннет', fragmentIds: ['frag:a'] },
    locations: [{ value: 'Лонгборн', fragmentIds: ['frag:a'] }],
    appearancePrompt: 'тёмные живые глаза, простое платье эпохи Регентства',
    gender: 'female',
    age: 'около двадцати',
    greeting: 'Здравствуйте. Я Элизабет Беннет.',
    source: {
      normalizedTextHash: `sha256:${HASH}`,
      inventoryVersion: 'name-inventory-v1',
      fragmentSetHash: HASH,
      promptVersion: 'character-card-prompt-v1'
    },
    createdAt: '2026-09-10T10:00:00Z',
    ...overrides
  })
}

test('the first window outranks background windows in the generation queue', () => {
  assert.equal(characterCardMediaPriority('foreground'), 65)
  assert.equal(characterCardMediaPriority('background'), 45)
  assert.ok(CARD_MEDIA_PRIORITY.foreground > CARD_MEDIA_PRIORITY.background)
})

test('an unknown priority class degrades to background, never to foreground', () => {
  // Приоритет 65 забирает воркеры у всей очереди, поэтому неизвестное значение
  // не должно случайно получить его.
  for (const value of ['nonsense', '', null, undefined]) {
    assert.equal(characterCardMediaPriority(value), CARD_MEDIA_PRIORITY.background)
  }
})

test('the card appearance passport reaches the portrait prompt verbatim', () => {
  const projection = characterCardProjection(card())
  const normalized = normalizeCharacterBundleInput({
    bookEditionId: 'edition-1',
    characterKey: projection.characterKey,
    name: projection.name,
    fullName: projection.fullName,
    firstAppearanceTextOffset: 8_132,
    warmupTextOffset: 8_132,
    character: projection,
    scope: 'catalog',
    bookTitle: 'Гордость и предубеждение',
    bookAuthor: 'Джейн Остин',
    bundleVersion: 'character-bundle-v3:r1'
  })
  assert.equal(
    normalized.character.appearancePrompt,
    'тёмные живые глаза, простое платье эпохи Регентства'
  )
  const prompt = buildCharacterPortraitPrompt({
    character: normalized.character,
    fullName: normalized.fullName,
    bookTitle: 'Гордость и предубеждение',
    bookAuthor: 'Джейн Остин'
  })
  assert.match(prompt, /Внешность \(соблюдать точно\): тёмные живые глаза, простое платье/)
  assert.match(prompt, /Элизабет Беннет/)
})

test('the card projection satisfies the bundle request contract as it stands', () => {
  // Никакой второй ветки в генераторе не нужно: проекция карточки отдаёт ровно
  // тот набор полей, который валидатор пакета уже принимает.
  const projection = characterCardProjection(card())
  const normalized = normalizeCharacterBundleInput({
    bookEditionId: 'edition-1',
    characterKey: projection.characterKey,
    name: projection.name,
    fullName: projection.fullName,
    firstAppearanceTextOffset: 8_132,
    warmupTextOffset: 8_132,
    character: projection,
    scope: 'catalog',
    bookTitle: 'Книга',
    bookAuthor: '',
    bundleVersion: 'character-bundle-v3:r1'
  })
  const request = normalizeBundleRequest({
    idempotencyKey: 'edition-1:char:elizabeth-bennet:character-bundle-v3:r1:primary_portrait',
    bookEditionId: 'edition-1',
    characterKey: 'char:elizabeth-bennet',
    name: normalized.name,
    fullName: normalized.fullName,
    character: normalized.character,
    scope: 'catalog',
    bookTitle: 'Книга',
    bookAuthor: '',
    bundleVersion: 'character-bundle-v3:r1',
    requiredMedia: ['primary_portrait']
  })
  assert.deepEqual(request.requiredMedia, ['primary_portrait'])
  assert.equal(request.character.gender, 'female')
  assert.equal(request.character.greeting, 'Здравствуйте. Я Элизабет Беннет.')
})

test('a media job carrying a card revision reads the card, not the markup', async () => {
  const pool = scriptedPool([
    (sql) => {
      assert.match(sql, /FROM generation_jobs AS job/)
      assert.match(sql, /JOIN book_character_cards AS card/)
      assert.match(sql, /card\.enabled/)
      assert.doesNotMatch(sql, /book_markup_versions/)
      return {
        rows: [{
          document: card(),
          first_mention_text_offset: 8_132,
          scope: 'catalog',
          title: 'Гордость и предубеждение',
          author: 'Джейн Остин'
        }]
      }
    }
  ])
  const repository = createPostgresBookMarkupRepository(pool)
  const input = await repository.getCharacterBundleInput({
    id: 'job-portrait',
    bookEditionId: 'edition-1',
    characterKey: 'char:elizabeth-bennet',
    leaseToken: 'lease-1',
    targetVersion: 'character-bundle-v3:r1',
    payload: { card_revision: 1, asset_type: 'primary_portrait' }
  })
  assert.equal(input.characterKey, 'char:elizabeth-bennet')
  assert.equal(input.character.appearancePrompt, 'тёмные живые глаза, простое платье эпохи Регентства')
  assert.equal(input.character.cardStatus, 'ready')
  assert.equal(input.warmupTextOffset, 8_132)
})

test('a media job with no card revision keeps reading the published markup', async () => {
  const pool = scriptedPool([
    (sql) => {
      assert.match(sql, /JOIN book_characters AS character/)
      return {
        rows: [{
          character_key: 'anna',
          name: 'Анна',
          full_name: 'Анна Каренина',
          first_appearance_text_offset: 100,
          warmup_text_offset: 50,
          data: { appearancePrompt: 'из разметки' },
          scope: 'catalog',
          title: 'Анна Каренина',
          author: 'Лев Толстой'
        }]
      }
    }
  ])
  const repository = createPostgresBookMarkupRepository(pool)
  const input = await repository.getCharacterBundleInput({
    id: 'job-portrait',
    bookEditionId: 'edition-1',
    characterKey: 'anna',
    leaseToken: 'lease-1',
    targetVersion: 'character-bundle-v1:r1',
    payload: { asset_type: 'primary_portrait' }
  })
  assert.equal(input.character.appearancePrompt, 'из разметки')
})

test('a hand-edited card row is refused before it reaches the portrait prompt', async () => {
  const broken = { ...card(), bio: 'уже не утверждение, а строка' }
  const pool = scriptedPool([
    () => ({
      rows: [{
        document: broken,
        first_mention_text_offset: 8_132,
        scope: 'catalog',
        title: 'Книга',
        author: ''
      }]
    })
  ])
  const repository = createPostgresBookMarkupRepository(pool)
  await assert.rejects(
    () => repository.getCharacterBundleInput({
      id: 'job-portrait',
      bookEditionId: 'edition-1',
      characterKey: 'char:elizabeth-bennet',
      leaseToken: 'lease-1',
      targetVersion: 'character-bundle-v3:r1',
      payload: { card_revision: 1 }
    }),
    { code: 'CHARACTER_CARD_INVALID' }
  )
})

test('publishing a card queues its media from the card hash at the window priority', async () => {
  const mediaJob = (id, type, assetType) => ({
    id,
    job_type: type,
    book_edition_id: 'edition-1',
    character_key: 'char:elizabeth-bennet',
    target_version: 'character-bundle-v3:r1',
    status: 'queued',
    attempts: 0,
    payload: { bundle_version: 'character-bundle-v3', required_media: [assetType] }
  })
  const inserts = []
  const pool = scriptedPool([
    () => ({ rows: [{ id: 'job-card', status: 'running' }] }), // requireLeasedJob
    () => ({ rows: [] }),                                       // disable prior revisions
    () => ({ rows: [{ id: 'card-1' }] }),                       // insert card
    () => ({ rows: [] }),                                       // advisory lock
    (sql) => {                                                  // card media source
      assert.match(sql, /FROM book_character_cards AS card/)
      // Источник медиа — поля, из которых медиа делается, а не вся карточка:
      // в document_hash входят createdAt, счётчик упоминаний и границы окна, и
      // любая пересборка карточки перерисовывала портрет заново.
      assert.match(sql, /appearancePrompt/)
      assert.match(sql, /greeting/)
      assert.doesNotMatch(sql, /card\.document_hash AS source_markup_hash/)
      return {
        rows: [{
          source_markup_hash: 'b'.repeat(64),
          card_revision: 1,
          run_id: 'run-1',
          window_index: 0,
          bundle_id: null,
          bundle_status: null,
          previous_source_markup_hash: null,
          media_revision: null
        }]
      }
    },
    () => ({ rows: [] }),                                       // insert bundle
    () => ({ rows: [{ count: 0 }] }),                           // completeness
    (sql, params) => { inserts.push(params); return { rows: [mediaJob('job-portrait', 'character_portrait', 'primary_portrait')] } },
    (sql, params) => { inserts.push(params); return { rows: [mediaJob('job-audio', 'character_audio', 'greeting_audio')] } },
    () => ({ rows: [] }),                                       // bundle job_id
    () => ({ rows: [] })                                        // finish the card job
  ])
  const repository = createPostgresBookMarkupRepository(pool, {
    idFactory: () => '123e4567-e89b-42d3-a456-426614174000'
  })
  const result = await repository.publishCharacterCard(
    { id: 'job-card', bookEditionId: 'edition-1', characterKey: 'char:elizabeth-bennet', leaseToken: 'lease-1' },
    {
      runId: 'run-1',
      bookEditionId: 'edition-1',
      characterKey: 'char:elizabeth-bennet',
      windowIndex: 0,
      cardRevision: 1,
      fragmentSetHash: HASH,
      normalizedTextHash: HASH,
      promptVersion: 'character-card-prompt-v1',
      mediaPriority: CARD_MEDIA_PRIORITY.foreground,
      card: card()
    }
  )
  assert.equal(result.status, 'published')
  assert.equal(result.media.status, 'queued')
  // Ставится ровно заказанный состав: idle-анимации в нём нет, и вызова
  // видеогенерации на каждого персонажа тоже.
  assert.equal(inserts.length, REQUIRED_CHARACTER_MEDIA.length)
  assert.deepEqual(
    inserts.map((params) => JSON.parse(params[7]).asset_type),
    [...REQUIRED_CHARACTER_MEDIA]
  )
  for (const params of inserts) {
    assert.equal(params[6], 65, 'приоритет окна 1')
    const payload = JSON.parse(params[7])
    assert.equal(payload.card_revision, 1)
    assert.equal(payload.card_window_index, 0)
    assert.equal(payload.analysis_run_id, 'run-1')
    assert.equal(payload.source_markup_hash, 'b'.repeat(64))
    assert.equal(payload.markup_version_id, undefined, 'у карточки нет версии разметки')
  }
  // Медиа ставится в той же транзакции, что и карточка.
  assert.ok(pool.queries.every(({ transaction }) => transaction))
})

test('publishing a card without an enabled card row refuses to queue media', async () => {
  const pool = scriptedPool([
    () => ({ rows: [{ id: 'job-card', status: 'running' }] }),
    () => ({ rows: [] }),
    () => ({ rows: [{ id: 'card-1' }] }),
    () => ({ rows: [] }),
    () => ({ rows: [] })
  ])
  const repository = createPostgresBookMarkupRepository(pool, {
    idFactory: () => '123e4567-e89b-42d3-a456-426614174000'
  })
  await assert.rejects(
    () => repository.publishCharacterCard(
      { id: 'job-card', bookEditionId: 'edition-1', characterKey: 'char:x', leaseToken: 'lease-1' },
      {
        runId: 'run-1',
        bookEditionId: 'edition-1',
        characterKey: 'char:x',
        windowIndex: 0,
        cardRevision: 1,
        fragmentSetHash: HASH,
        normalizedTextHash: HASH,
        promptVersion: 'character-card-prompt-v1',
        card: card()
      }
    ),
    { code: 'CARD_MEDIA_SOURCE_MISSING' }
  )
})

test('the claim query gates card-sourced media on an enabled card', async () => {
  const pool = scriptedPool([(sql) => {
    assert.match(sql, /NOT \(job\.payload \? 'card_revision'\)/)
    assert.match(sql, /FROM book_character_cards AS card/)
    assert.match(sql, /card\.enabled/)
    return { rows: [] }
  }])
  const repository = createPostgresBookMarkupRepository(pool)
  assert.equal(await repository.claimGenerationJob('worker-1'), null)
})
