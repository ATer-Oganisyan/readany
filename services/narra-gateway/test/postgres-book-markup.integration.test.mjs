import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { REQUIRED_CHARACTER_MEDIA } from '../book-markup.mjs'
import { createOperationalMetricsRepository } from '../operational-metrics-repository.mjs'
import { createPostgresBookMarkupRepository } from '../postgres-book-markup-repository.mjs'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

test('PostgreSQL operational metrics query the migrated schema', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 2 })
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    const snapshot = await createOperationalMetricsRepository(pool).snapshot({
      runtime: { providerFailures: [] },
      concurrency: { speech: { active: 0, waiting: 0, limit: 1 } },
      buildVersion: 'integration-test'
    })
    assert.equal(snapshot.buildVersion, 'integration-test')
    assert.ok(
      snapshot.generationQueue.oldestClaimableAgeMs === null ||
      Number.isFinite(snapshot.generationQueue.oldestClaimableAgeMs)
    )
    assert.ok(
      snapshot.analysisQueue.oldestRunningLeaseAgeMs === null ||
      Number.isFinite(snapshot.analysisQueue.oldestRunningLeaseAgeMs)
    )
    assert.ok(Array.isArray(snapshot.workers))
  } finally {
    await pool.end()
  }
})

test('PostgreSQL serializes parallel private identity, progress and manifest reads', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 12 })
  const bookEditionId = randomUUID()
  const subjectId = randomUUID()
  const hash = createHash('sha256').update(`lock-order-${bookEditionId}`).digest('hex')
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, owner_subject_id, content_sha256, title, author, format,
         status, source_storage, expires_at
       ) VALUES (
         $1, 'private', $2, $3, 'Lock Order', '', 'epub',
         'marking_up', 'temporary', now() + interval '1 day'
       )`,
      [bookEditionId, subjectId, hash]
    )
    const repository = createPostgresBookMarkupRepository(pool)
    const operations = []
    for (let index = 1; index <= 20; index += 1) {
      operations.push(
        repository.getReaderBookIdentity({ subjectId, bookEditionId }),
        repository.advanceReaderPosition({
          subjectId,
          bookEditionId,
          progressFraction: index / 20,
          chapterKey: `chapter-${index}`
        }),
        repository.getReaderBookManifest({
          subjectId,
          bookEditionId,
          bundleVersion: 'character-bundle-v3'
        })
      )
    }
    const results = await Promise.all(operations)
    assert.equal(results.length, 60)
    const position = await pool.query(
      `SELECT reading_fraction FROM reader_book_positions
       WHERE subject_id = $1 AND book_edition_id = $2`,
      [subjectId, bookEditionId]
    )
    assert.equal(Number(position.rows[0].reading_fraction), 1)
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.end()
  }
})

test('PostgreSQL persists markup and independently publishes character media', {
  skip: !connectionString
}, async () => {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, ssl: false, max: 4 })
  const bookEditionId = randomUUID()
  const subjectId = randomUUID()
  const otherSubjectId = randomUUID()
  const privateEditionId = randomUUID()
  let localEditionId
  const legacyEditionId = randomUUID()
  const hash = 'a'.repeat(64)
  try {
    await runBookMarkupMigrations(pool, { logger: { info() {} } })
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, language, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Integration Book', 'ReadAny', 'en', 'epub', 'marking_up')`,
      [bookEditionId, `integration-${bookEditionId}`, hash]
    )
    await pool.query(
      `INSERT INTO book_files (
         book_edition_id, object_key, mime_type, byte_size, content_hash, status
       ) VALUES ($1, $2, 'application/epub+zip', 128, $3, 'ready')`,
      [bookEditionId, `integration/${bookEditionId}/source.epub`, hash]
    )

    const repository = createPostgresBookMarkupRepository(pool)
    const markupJob = await repository.enqueueBookMarkup({ bookEditionId })
    assert.equal(markupJob.created, true)
    const claimedMarkup = await repository.claimGenerationJob('integration-worker')
    assert.equal(claimedMarkup.id, markupJob.id)
    assert.deepEqual(await repository.getBookMarkupInput(claimedMarkup), {
      bookEditionId,
      analysisVersion: 'book-markup-v2',
      scope: 'catalog',
      title: 'Integration Book',
      author: 'ReadAny',
      format: 'epub',
      contentSha256: hash,
      objectKey: `integration/${bookEditionId}/source.epub`,
      mimeType: 'application/epub+zip',
      byteSize: 128
    })
    await repository.publishBookMarkup(claimedMarkup, {
      inputHash: hash,
      textLength: 1_000,
      characters: [
        {
          characterKey: 'anna', name: 'Anna', fullName: 'Anna Karenina',
          warmupTextOffset: 80, firstAppearanceTextOffset: 100
        },
        {
          characterKey: 'vronsky', name: 'Vronsky', fullName: 'Alexey Vronsky',
          warmupTextOffset: 100, firstAppearanceTextOffset: 120
        }
      ]
    })

    const duplicateEnsures = await Promise.all([
      repository.ensureCharacterBundle({ bookEditionId, characterKey: 'anna' }),
      repository.ensureCharacterBundle({ bookEditionId, characterKey: 'anna' })
    ])
    assert.equal(duplicateEnsures.filter(({ created }) => created).length, 1)
    await repository.ensureCharacterBundle({ bookEditionId, characterKey: 'vronsky' })

    const assetTypeByJob = {
      character_portrait: 'primary_portrait',
      character_audio: 'greeting_audio',
      character_animation: 'idle_animation'
    }
    const completedByCharacter = new Map()
    for (let index = 0; index < 6; index += 1) {
      const job = await repository.claimGenerationJob('integration-worker')
      assert.ok(['anna', 'vronsky'].includes(job.characterKey))
      const characterKey = job.characterKey
      const input = await repository.getCharacterBundleInput(job)
      assert.equal(input.characterKey, characterKey)
      const type = assetTypeByJob[job.type]
      assert.ok(type)
      await repository.publishCharacterBundle(job, {
        assets: [{
          type,
          objectKey: `integration/${bookEditionId}/${characterKey}/${type}`,
          contentHash: hash,
          mimeType: type === 'primary_portrait'
            ? 'image/png'
            : type === 'greeting_audio' ? 'audio/wav' : 'video/mp4',
          byteSize: 64
        }]
      })
      completedByCharacter.set(characterKey, (completedByCharacter.get(characterKey) ?? 0) + 1)
      if (type === 'primary_portrait') {
        const partial = await pool.query(
          `SELECT link.asset_type
           FROM character_media_bundles AS bundle
           JOIN character_bundle_assets AS link ON link.bundle_id = bundle.id
           WHERE bundle.book_edition_id = $1 AND bundle.character_key = $2`,
          [bookEditionId, characterKey]
        )
        assert.equal(partial.rows.some((row) => row.asset_type === 'primary_portrait'), true)
      }
    }
    assert.deepEqual(Object.fromEntries(completedByCharacter), { anna: 3, vronsky: 3 })
    const edition = await pool.query('SELECT status FROM book_editions WHERE id = $1', [bookEditionId])
    assert.equal(edition.rows[0].status, 'base_ready')

    await pool.query(
      `UPDATE character_media_bundles
       SET status = 'failed'
       WHERE book_edition_id = $1 AND character_key = 'vronsky'`,
      [bookEditionId]
    )
    assert.deepEqual(await repository.enqueueCharacterMediaBackfill(), [])
    const reconciledBundle = await pool.query(
      `SELECT status FROM character_media_bundles
       WHERE book_edition_id = $1 AND character_key = 'vronsky'`,
      [bookEditionId]
    )
    assert.equal(reconciledBundle.rows[0].status, 'ready')

    const coverEnsure = await repository.enqueueCatalogCover({ bookEditionId })
    assert.equal(coverEnsure.created, true)
    const coverJob = await repository.claimGenerationJob('integration-worker')
    assert.equal(coverJob.type, 'catalog_cover')
    assert.deepEqual(await repository.getCatalogCoverInput(coverJob), {
      bookEditionId,
      targetVersion: `catalog-cover-v4-${hash.slice(0, 16)}`,
      scope: 'catalog',
      title: 'Integration Book',
      author: 'ReadAny',
      format: 'epub',
      contentSha256: hash,
      objectKey: `integration/${bookEditionId}/source.epub`,
      mimeType: 'application/epub+zip',
      byteSize: 128,
      context: ''
    })
    await repository.publishCatalogCover(coverJob, {
      objectKey: `books/catalog/${bookEditionId}/cover/generated.png`,
      contentHash: 'e'.repeat(64),
      mimeType: 'image/png',
      byteSize: 128
    })

    const catalog = await repository.listCatalogBooks({ limit: 20 })
    const catalogEdition = catalog.items.find(({ id }) => id === bookEditionId)
    assert.ok(catalogEdition)
    assert.equal(catalogEdition.language, 'en')
    assert.equal(
      (await repository.listCatalogBooks({ limit: 100, language: 'ru' }))
        .items.some(({ id }) => id === bookEditionId),
      false
    )
    assert.equal(
      (await repository.listCatalogBooks({ limit: 100, language: 'en' }))
        .items.some(({ id }) => id === bookEditionId),
      true
    )
    assert.equal(catalogEdition.cover.contentHash, 'e'.repeat(64))
    assert.equal((await repository.resolveBook({
      subjectId,
      source: 'local',
      contentSha256: hash
    })).id, bookEditionId)

    const progress = await repository.advanceReaderPosition({
      subjectId,
      bookEditionId,
      progressFraction: 0.09,
      chapterKey: 'chapter-1'
    })
    assert.equal(progress.readerTextOffset, 90)
    assert.equal(progress.readingFraction, 0.09)
    assert.deepEqual(
      progress.charactersDue.map(({ characterKey }) => characterKey),
      ['anna', 'vronsky']
    )
    const rewind = await repository.advanceReaderPosition({
      subjectId,
      bookEditionId,
      progressFraction: 0.01,
      chapterKey: 'chapter-0'
    })
    assert.equal(rewind.readerTextOffset, 90)
    assert.equal(rewind.readingFraction, 0.09)
    assert.equal(rewind.chapterKey, 'chapter-1')

    await repository.advanceReaderPosition({
      subjectId,
      bookEditionId,
      progressFraction: 0.11,
      chapterKey: 'chapter-2'
    })
    const manifest = await repository.getReaderBookManifest({
      subjectId,
      bookEditionId,
      bundleVersion: 'character-bundle-v1'
    })
    assert.equal(manifest.readerTextOffset, 110)
    assert.equal(manifest.readingFraction, 0.11)
    assert.equal(manifest.markup.textLength, 1_000)
    assert.equal(manifest.characters.length, 2)
    assert.equal(manifest.characters[0].bundle.assets.length, REQUIRED_CHARACTER_MEDIA.length)
    assert.equal((await repository.getReaderBookSource({
      subjectId,
      bookEditionId
    })).contentHash, hash)
    const annaAsset = manifest.characters[0].bundle.assets[0]
    const vronskyAsset = manifest.characters[1].bundle.assets[0]
    assert.equal((await repository.getReaderMediaAsset({
      subjectId,
      bookEditionId,
      assetId: annaAsset.assetId
    })).assetId, annaAsset.assetId)
    assert.equal(await repository.getReaderMediaAsset({
      subjectId,
      bookEditionId,
      assetId: vronskyAsset.assetId
    }), null)

    const privateHash = 'b'.repeat(64)
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, owner_subject_id, content_sha256, title, author, format,
         status, source_storage, expires_at
       ) VALUES (
         $1, 'private', $2, $3, 'Private Book', '', 'fb2',
         'base_ready', 'local_only', now() + interval '7 days'
       )`,
      [privateEditionId, subjectId, privateHash]
    )
    assert.equal((await repository.resolveBook({
      subjectId,
      source: 'local',
      contentSha256: privateHash
    })).id, privateEditionId)
    assert.equal(await repository.resolveBook({
      subjectId: otherSubjectId,
      source: 'local',
      contentSha256: privateHash
    }), null)
    assert.equal(await repository.getReaderBookManifest({
      subjectId: otherSubjectId,
      bookEditionId: privateEditionId,
      bundleVersion: 'character-bundle-v1'
    }), null)
    assert.equal(await repository.advanceReaderPosition({
      subjectId: otherSubjectId,
      bookEditionId: privateEditionId,
      progressFraction: 0.01
    }), null)

    const localHash = 'c'.repeat(64)
    const prepared = await repository.registerLocalBook({
      subjectId,
      proposedBookEditionId: randomUUID(),
      contentSha256: localHash,
      title: 'Local Book',
      author: 'Reader',
      format: 'epub',
      language: 'ru'
    })
    localEditionId = prepared.id
    assert.equal(prepared.sourceStorage, 'local_only')
    assert.equal(prepared.language, 'ru')
    assert.equal((await repository.registerLocalBook({
      subjectId,
      proposedBookEditionId: randomUUID(),
      contentSha256: localHash,
      title: 'Local Book',
      author: 'Reader',
      format: 'epub'
    })).language, 'ru')
    assert.equal(await repository.getReaderBookSource({
      bookEditionId: prepared.id
    }), null)
    const published = await repository.publishLocalBookMarkup({
      subjectId,
      bookEditionId: prepared.id,
      analysisVersion: 'local-character-v1',
      inputHash: localHash,
      textLength: 1_000_000,
      characters: [{
        characterKey: 'local-hero', name: 'Hero', fullName: 'Local Hero',
        firstAppearanceTextOffset: 100_000, warmupTextOffset: 50_000,
        profile: { role: 'hero' }
      }]
    })
    assert.equal(published.edition.status, 'base_ready')
    const localBundleJob = await repository.ensureCharacterBundle({
      bookEditionId: prepared.id,
      characterKey: 'local-hero'
    })
    await pool.query(
      `UPDATE book_editions SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [prepared.id]
    )
    assert.equal((await repository.purgeExpiredPrivateEditions()).deletedEditions, 1)
    const cacheKey = `generated/cache/${createHash('sha256')
      .update(localBundleJob.idempotencyKey)
      .digest('hex')}.json`
    assert.equal((await repository.listBookObjectDeletions()).includes(cacheKey), true)
    await repository.acknowledgeBookObjectDeletions([cacheKey])
    localEditionId = null

    const legacyHash = 'd'.repeat(64)
    const legacyMarkupId = randomUUID()
    await pool.query(
      `INSERT INTO book_editions (
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Legacy Book', 'ReadAny', 'epub', 'base_ready')`,
      [legacyEditionId, `legacy-${legacyEditionId}`, legacyHash]
    )
    await pool.query(
      `INSERT INTO book_files (
         book_edition_id, object_key, mime_type, byte_size, content_hash, status
       ) VALUES ($1, $2, 'application/epub+zip', 64, $3, 'ready')`,
      [legacyEditionId, `integration/${legacyEditionId}/source.epub`, legacyHash]
    )
    await pool.query(
      `INSERT INTO book_markup_versions (
         id, book_edition_id, schema_version, analysis_version, revision,
         status, input_hash, published_at
       ) VALUES ($1, $2, 1, 'book-markup-v1', 1, 'published', $3, now())`,
      [legacyMarkupId, legacyEditionId, legacyHash]
    )
    const backfill = await repository.enqueueBookMarkupBackfill({ limit: 100 })
    assert.equal(backfill.some((job) =>
      job.bookEditionId === legacyEditionId && job.targetVersion === 'book-markup-v2'
    ), true)
    assert.equal((await repository.enqueueBookMarkupBackfill({ limit: 100 })).length, 0)
  } finally {
    await pool.query('DELETE FROM book_editions WHERE id = $1', [bookEditionId]).catch(() => {})
    await pool.query('DELETE FROM book_editions WHERE id = $1', [privateEditionId]).catch(() => {})
    if (localEditionId) {
      await pool.query('DELETE FROM book_editions WHERE id = $1', [localEditionId]).catch(() => {})
    }
    await pool.query('DELETE FROM book_editions WHERE id = $1', [legacyEditionId]).catch(() => {})
    await pool.end()
  }
})
