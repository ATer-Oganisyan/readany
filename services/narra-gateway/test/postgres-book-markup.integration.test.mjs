import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { REQUIRED_CHARACTER_MEDIA } from '../book-markup.mjs'
import { createPostgresBookMarkupRepository } from '../postgres-book-markup-repository.mjs'
import { runBookMarkupMigrations } from '../postgres-runtime.mjs'

const connectionString = process.env.BOOK_MARKUP_TEST_DATABASE_URL

test('PostgreSQL persists an idempotent catalog markup and atomic character bundles', {
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
         id, scope, catalog_key, content_sha256, title, author, format, status
       ) VALUES ($1, 'catalog', $2, $3, 'Integration Book', 'ReadAny', 'epub', 'marking_up')`,
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

    for (const characterKey of ['anna', 'vronsky']) {
      const job = await repository.claimGenerationJob('integration-worker')
      assert.equal(job.characterKey, characterKey)
      const input = await repository.getCharacterBundleInput(job)
      assert.equal(input.characterKey, characterKey)
      await repository.publishCharacterBundle(job, {
        assets: REQUIRED_CHARACTER_MEDIA.map((type) => ({
          type,
          objectKey: `integration/${bookEditionId}/${characterKey}/${type}`,
          contentHash: hash,
          mimeType: type === 'primary_portrait' ? 'image/png' : 'application/octet-stream',
          byteSize: 64
        }))
      })
      const edition = await pool.query('SELECT status FROM book_editions WHERE id = $1', [bookEditionId])
      assert.equal(edition.rows[0].status, characterKey === 'anna' ? 'generating_portraits' : 'base_ready')
    }

    const catalog = await repository.listCatalogBooks({ limit: 20 })
    assert.equal(catalog.items.some(({ id }) => id === bookEditionId), true)
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
    assert.deepEqual(progress.charactersDue.map(({ characterKey }) => characterKey), ['anna'])
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
      format: 'epub'
    })
    localEditionId = prepared.id
    assert.equal(prepared.sourceStorage, 'local_only')
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
