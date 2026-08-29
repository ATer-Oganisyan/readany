import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { bookIdentityTargetVersion } from '../book-identity.mjs'
import { createPostgresBookMarkupRepository } from '../postgres-book-markup-repository.mjs'

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

test('durable character ensure returns existing independent media jobs', async () => {
  const job = (id, type, assetType) => ({
    id,
    job_type: type,
    book_edition_id: 'book-42',
    character_key: 'anna',
    target_version: 'character-bundle-v1:r1',
    status: 'running',
    attempts: 1,
    payload: { bundle_version: 'character-bundle-v1', required_media: [assetType] }
  })
  const pool = scriptedPool([
    () => ({ rows: [] }),
    () => ({ rows: [{
      markup_version_id: 'markup-1',
      source_markup_hash: 'a'.repeat(64),
      bundle_id: 'bundle-1',
      bundle_status: 'running',
      previous_source_markup_hash: 'a'.repeat(64),
      media_revision: 1
    }] }),
    () => ({ rows: [{ count: 0 }] }),
    () => ({ rows: [] }),
    () => ({ rows: [job('job-portrait', 'character_portrait', 'primary_portrait')] }),
    () => ({ rows: [] }),
    () => ({ rows: [job('job-audio', 'character_audio', 'greeting_audio')] }),
    () => ({ rows: [] }),
    () => ({ rows: [job('job-animation', 'character_animation', 'idle_animation')] }),
    () => ({ rows: [] })
  ])
  const repository = createPostgresBookMarkupRepository(pool, {
    idFactory: () => '123e4567-e89b-42d3-a456-426614174000'
  })
  const result = await repository.ensureCharacterBundle({
    bookEditionId: 'book-42',
    characterKey: 'anna'
  })
  assert.equal(result.created, false)
  assert.equal(result.id, 'job-portrait')
  assert.equal(result.status, 'queued')
  assert.equal(result.jobs.length, 3)
  assert.equal(
    result.idempotencyKey,
    'book-42:anna:character-bundle-v1:r1:primary_portrait'
  )
  assert.match(pool.queries[4].sql, /ON CONFLICT \(idempotency_key\) DO NOTHING/)
})

test('claim query uses skip locked and assigns a unique lease token', async () => {
  const pool = scriptedPool([
    (sql, params) => ({ rows: [{
      id: 'job-1', job_type: 'book_markup', book_edition_id: 'book-1',
      character_key: null, target_version: 'book-markup-v1', status: 'running',
      attempts: 1, lease_token: params[2], payload: {}
    }] })
  ])
  const repository = createPostgresBookMarkupRepository(pool, {
    idFactory: () => '123e4567-e89b-42d3-a456-426614174001'
  })
  const job = await repository.claimGenerationJob('worker-1')
  assert.equal(job.leaseToken, '123e4567-e89b-42d3-a456-426614174001')
  assert.match(pool.queries[0].sql, /FOR UPDATE SKIP LOCKED/)
  assert.match(pool.queries[0].sql, /lease_token = \$3::uuid/)
})

test('claim query can isolate the book identity worker queue', async () => {
  const pool = scriptedPool([() => ({ rows: [] })])
  const repository = createPostgresBookMarkupRepository(pool, {
    idFactory: () => '123e4567-e89b-42d3-a456-426614174001'
  })
  await repository.claimGenerationJob('identity-worker', {
    jobTypes: ['book_identity']
  })
  assert.match(pool.queries[0].sql, /job_type = ANY\(\$4::text\[\]\)/)
  assert.match(pool.queries[0].sql, /identity\.status IN \('queued', 'running'\)/)
  assert.deepEqual(pool.queries[0].params[3], ['book_identity'])
})

test('catalog API prefers the identity worker display metadata', async () => {
  const pool = scriptedPool([() => ({ rows: [{
    id: 'book-1', scope: 'catalog', catalog_key: 'book-1', content_sha256: 'a'.repeat(64),
    title: 'Мертвое озеро (Часть первая)', author: 'Николай Некрасов (1821—1877)',
    display_title: 'Мертвое озеро', display_author: 'Николай Некрасов',
    genres: ['mystery-thriller', 'literary-fiction'],
    language: 'ru', format: 'fb2', status: 'base_ready', source_storage: 'stored',
    expires_at: null, created_at: new Date('2026-08-20T00:00:00.000Z')
  }] })])
  const repository = createPostgresBookMarkupRepository(pool)
  const result = await repository.listCatalogBooks({ limit: 20, language: 'ru' })
  assert.equal(result.items[0].title, 'Мертвое озеро')
  assert.equal(result.items[0].author, 'Николай Некрасов')
  assert.deepEqual(result.items[0].genres, ['mystery-thriller', 'literary-fiction'])
  assert.equal(result.items[0].language, 'ru')
  assert.match(pool.queries[0].sql, /edition\.display_title, edition\.display_author/)
  assert.match(pool.queries[0].sql, /array_agg\(link\.genre ORDER BY link\.position\)/)
  assert.match(pool.queries[0].sql, /edition\.catalog_hidden_at IS NULL/)
  assert.match(pool.queries[0].sql, /edition\.language = \$4/)
  assert.equal(pool.queries[0].params[3], 'ru')
})

test('catalog replacement hides only an already published same-language successor', async () => {
  const hiddenAt = new Date('2026-08-30T00:00:00.000Z')
  const pool = scriptedPool([() => ({ rows: [{
    id: 'old-book',
    catalog_hidden_at: hiddenAt,
    replaced_by_book_edition_id: 'new-book'
  }] })])
  const repository = createPostgresBookMarkupRepository(pool)

  const result = await repository.hideReplacedCatalogBook({
    bookEditionId: 'old-book',
    replacedByBookEditionId: 'new-book'
  })

  assert.equal(result.id, 'old-book')
  assert.equal(result.replaced_by_book_edition_id, 'new-book')
  const update = pool.queries.find(({ sql }) => /UPDATE book_editions AS old_edition/.test(sql))
  assert.ok(update)
  assert.deepEqual(update.params, ['old-book', 'new-book'])
  assert.match(update.sql, /old_edition\.language IS NOT DISTINCT FROM replacement\.language/)
  assert.match(update.sql, /old_edition\.display_title/)
  assert.match(update.sql, /replacement\.display_title/)
  assert.match(update.sql, /old_edition\.content_sha256 <> replacement\.content_sha256/)
  assert.match(update.sql, /replacement\.status IN \('base_ready', 'published'\)/)
  assert.match(update.sql, /book_analysis_publications AS publication/)
})

test('private identity polling returns the normalized title as soon as its durable job publishes', async () => {
  const updatedAt = new Date('2026-08-25T10:00:00.000Z')
  const edition = {
    id: 'book-1', scope: 'private', content_sha256: 'a'.repeat(64),
    title: 'Мертвое озеро (Часть первая)', author: 'Николай Некрасов (1821—1877)',
    display_title: 'Мертвое озеро', display_author: 'Николай Некрасов',
    identity_source: 'llm', identity_updated_at: updatedAt
  }
  edition.identity_version = bookIdentityTargetVersion({
    contentSha256: edition.content_sha256,
    title: edition.title,
    author: edition.author
  })
  const pool = scriptedPool([
    () => ({ rows: [edition] }),
    () => ({ rows: [] })
  ])
  const repository = createPostgresBookMarkupRepository(pool)
  assert.deepEqual(await repository.getReaderBookIdentity({
    subjectId: '123e4567-e89b-42d3-a456-426614174000',
    bookEditionId: 'book-1'
  }), {
    bookEditionId: 'book-1', version: 'book-identity-v1', status: 'ready',
    title: 'Мертвое озеро', author: 'Николай Некрасов', source: 'llm',
    updatedAt: updatedAt.toISOString()
  })
  assert.ok(pool.queries.some(({ sql }) => /owner_subject_id = \$2::uuid/.test(sql)))
})

test('identity polling reports processing without waiting for book markup', async () => {
  const edition = {
    id: 'book-1', scope: 'private', content_sha256: 'a'.repeat(64),
    title: 'Book', author: 'Author', display_title: null, display_author: null,
    identity_version: null, identity_source: null, identity_updated_at: null
  }
  const pool = scriptedPool([
    () => ({ rows: [edition] }),
    () => ({ rows: [] }),
    () => ({ rows: [{ status: 'running', last_error_code: null }] })
  ])
  const repository = createPostgresBookMarkupRepository(pool)
  assert.deepEqual(await repository.getReaderBookIdentity({
    subjectId: '123e4567-e89b-42d3-a456-426614174000',
    bookEditionId: 'book-1'
  }), {
    bookEditionId: 'book-1', version: 'book-identity-v1', status: 'processing',
    errorCode: undefined
  })
  assert.ok(pool.queries.some(({ sql }) => /job_type = 'book_identity'/.test(sql)))
})

test('catalog content resolves the latest prepared normalized text only for catalog books', async () => {
  const pool = scriptedPool([() => ({ rows: [{
    book_edition_id: 'book-1',
    normalized_text_object_key: 'analysis/run-2/normalized-text-v1.txt',
    normalized_text_hash: 'a'.repeat(64),
    text_length: '1200',
    normalization_version: 'normalized-text-v1',
    content_navigation: null
  }] })])
  const repository = createPostgresBookMarkupRepository(pool)
  assert.deepEqual(await repository.getReaderBookContent({
    subjectId: 'reader-1',
    bookEditionId: 'book-1'
  }), {
    bookEditionId: 'book-1',
    objectKey: 'analysis/run-2/normalized-text-v1.txt',
    contentHash: 'a'.repeat(64),
    textLength: 1200,
    normalizationVersion: 'normalized-text-v1',
    navigation: null
  })
  assert.match(pool.queries[0].sql, /edition\.scope = 'catalog'/)
  assert.match(pool.queries[0].sql, /run\.normalization_version = 'normalized-text-v1'/)
  assert.match(pool.queries[0].sql, /run\.run_sequence DESC/)
})

test('stale identity publication cannot overwrite newer raw metadata', async () => {
  const pool = scriptedPool([
    () => ({ rows: [{ id: 'job-old' }] }),
    () => ({ rows: [{
      id: 'book-1', content_sha256: 'a'.repeat(64), title: 'Новое название',
      author: 'Автор', identity_version: null
    }] }),
    (_sql, params) => ({ rows: [{
      id: params[0], job_type: 'book_identity', book_edition_id: 'book-1',
      character_key: null, target_version: params[3], status: 'queued', attempts: 0,
      payload: {}
    }] }),
    () => ({ rows: [] })
  ])
  const repository = createPostgresBookMarkupRepository(pool, {
    idFactory: () => '123e4567-e89b-42d3-a456-426614174001'
  })
  const result = await repository.publishBookIdentity({
    id: 'job-old', bookEditionId: 'book-1', targetVersion: 'book-identity-v1-old',
    leaseToken: '123e4567-e89b-42d3-a456-426614174002'
  }, { title: 'Старое название', author: 'Старый автор', source: 'llm' })
  assert.equal(result.status, 'stale')
  assert.equal(pool.queries.some(({ sql }) => /SET display_title/.test(sql)), false)
})

test('identity publication keeps a valid raw author when the LLM omits it', async () => {
  const edition = {
    id: 'book-1', content_sha256: 'a'.repeat(64), title: 'Книга',
    author: 'Исходный автор', identity_version: null
  }
  const targetVersion = bookIdentityTargetVersion({
    contentSha256: edition.content_sha256,
    title: edition.title,
    author: edition.author
  })
  let publishedParams
  const pool = scriptedPool([
    () => ({ rows: [{ id: 'job-current' }] }),
    () => ({ rows: [edition] }),
    (_sql, params) => { publishedParams = params; return { rows: [] } },
    () => ({ rows: [] })
  ])
  const repository = createPostgresBookMarkupRepository(pool)
  const result = await repository.publishBookIdentity({
    id: 'job-current', bookEditionId: 'book-1', targetVersion,
    leaseToken: '123e4567-e89b-42d3-a456-426614174002'
  }, { title: 'Книга', author: '', source: 'llm' })
  assert.equal(result.status, 'ready')
  assert.equal(publishedParams[2], 'Исходный автор')
})

test('character bundle input includes durable appearance offsets for legacy profiles', async () => {
  const pool = scriptedPool([
    (sql) => {
      assert.match(sql, /character\.first_appearance_text_offset/)
      assert.match(sql, /character\.warmup_text_offset/)
      return { rows: [{
        character_key: 'hero',
        name: 'Герой',
        full_name: 'Главный герой',
        first_appearance_text_offset: '120000',
        warmup_text_offset: '70000',
        data: { role: 'Главный герой' },
        scope: 'private',
        title: 'Книга',
        author: 'Автор'
      }] }
    }
  ])
  const repository = createPostgresBookMarkupRepository(pool)
  const input = await repository.getCharacterBundleInput({
    id: 'job-1',
    bookEditionId: 'book-1',
    targetVersion: 'character-bundle-v1',
    leaseToken: '123e4567-e89b-42d3-a456-426614174001'
  })
  assert.equal(input.firstAppearanceTextOffset, 120_000)
  assert.equal(input.warmupTextOffset, 70_000)
  assert.deepEqual(input.character, { role: 'Главный герой' })
})

test('failed generation retry preserves the idempotent job and resets its bundle', async () => {
  const row = {
    id: 'job-failed', job_type: 'character_bundle', book_edition_id: 'book-1',
    character_key: 'hero', target_version: 'character-bundle-v1', status: 'queued',
    attempts: 0, payload: {}
  }
  const pool = scriptedPool([
    (sql) => {
      assert.match(sql, /FOR UPDATE SKIP LOCKED/)
      assert.match(sql, /attempts = 0/)
      return { rows: [row] }
    },
    (sql) => {
      assert.match(sql, /UPDATE character_media_bundles/)
      return { rows: [] }
    }
  ])
  const repository = createPostgresBookMarkupRepository(pool)
  const jobs = await repository.retryFailedGenerationJobs({ limit: 10 })
  assert.equal(jobs[0].id, 'job-failed')
  assert.equal(jobs[0].status, 'queued')
})

test('migration enforces durable idempotency and bundle uniqueness', async () => {
  const migration = await readFile(
    new URL('../migrations/001_book_markup.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /idempotency_key TEXT NOT NULL UNIQUE/)
  assert.match(migration, /UNIQUE \(book_edition_id, character_key, bundle_version\)/)
  assert.match(migration, /warmup_text_offset <= first_appearance_text_offset/)
  assert.match(migration, /lease_token UUID/)
})

test('canonical progress migration is additive for existing markup rows', async () => {
  const migration = await readFile(
    new URL('../migrations/002_canonical_reader_progress.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /ADD COLUMN IF NOT EXISTS text_length BIGINT/)
  assert.match(migration, /text_length IS NULL OR text_length > 0/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS reading_fraction DOUBLE PRECISION/)
  assert.match(migration, /reading_fraction >= 0 AND reading_fraction <= 1/)
})

test('section-aware progress migration adds bounded optional coordinates', async () => {
  const migration = await readFile(
    new URL('../migrations/007_section_aware_reader_progress.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /ADD COLUMN IF NOT EXISTS section_index INTEGER/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS section_fraction DOUBLE PRECISION/)
  assert.match(migration, /section_index IS NULL OR section_index >= 0/)
  assert.match(migration, /section_fraction >= 0 AND section_fraction <= 1/)
})

test('local-only migration removes private source metadata and adds expiring object cleanup', async () => {
  const migration = await readFile(
    new URL('../migrations/003_local_books_and_retention.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /DELETE FROM book_files[\s\S]*edition\.scope = 'private'/)
  assert.match(migration, /scope = 'private' AND source_storage = 'local_only'/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS book_object_deletions/)
  assert.match(migration, /expires_at TIMESTAMPTZ/)
})

test('private v3 migration permits only expiring temporary source storage', async () => {
  const migration = await readFile(
    new URL('../migrations/008_private_v3_sources.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /scope = 'private' AND source_storage IN \('local_only', 'temporary'\)/)
  assert.match(migration, /WHERE scope = 'private'/)
})

test('v3 media migration accepts canonical namespaced character keys', async () => {
  const migration = await readFile(
    new URL('../migrations/009_v3_character_media.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /character_key ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]/)
  assert.match(migration, /book_characters_key_v3/)
})

test('analysis rerun migration versions runs without replacing prior publications', async () => {
  const migration = await readFile(
    new URL('../migrations/010_book_analysis_reruns.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /ADD COLUMN run_sequence INTEGER NOT NULL DEFAULT 1/)
  assert.match(migration, /UNIQUE \(book_edition_id, input_hash, pipeline_version, prompt_version, run_sequence\)/)
  assert.doesNotMatch(migration, /DELETE FROM book_analysis_publications/)
  assert.doesNotMatch(migration, /UPDATE book_analysis_publications/)
})

test('pipeline migration freezes run and job identity and separates cache lineages', async () => {
  const migration = await readFile(
    new URL('../migrations/013_book_analysis_pipelines.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /pipeline_id IN \('narra', 'external'\)/)
  assert.match(migration, /pipeline_implementation_version TEXT NOT NULL/)
  assert.match(migration, /normalization_version TEXT NOT NULL/)
  assert.match(migration, /output_schema_version INTEGER NOT NULL DEFAULT 3/)
  assert.match(migration, /book_analysis_runs_pipeline_sequence_unique/)
  assert.match(migration, /book_analysis_jobs_pipeline_identity/)
  assert.match(migration, /analysis pipeline identity is immutable/)
  assert.match(migration, /analysis run lineage is immutable/)
  assert.match(migration, /run\.pipeline_id = 'external'/)
})

test('catalog cover migration stores one verified presentation asset per edition', async () => {
  const migration = await readFile(
    new URL('../migrations/004_catalog_covers.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /book_edition_id UUID PRIMARY KEY/)
  assert.match(migration, /mime_type IN \('image\/jpeg', 'image\/png', 'image\/webp'\)/)
  assert.match(migration, /status IN \('staging', 'ready', 'failed'\)/)
})

test('parallel analysis migration isolates durable jobs and whole-book barriers', async () => {
  const migration = await readFile(
    new URL('../migrations/005_parallel_book_analysis.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /CREATE TABLE IF NOT EXISTS book_analysis_runs/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS book_analysis_chunks/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS book_analysis_jobs/)
  assert.match(migration, /UNIQUE \(run_id, stage, shard_key\)/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS book_analysis_observations/)
  assert.match(migration, /UNIQUE \(run_id, chunk_id, extractor_version, observation_key\)/)
  assert.match(migration, /observation_type IN \([\s\S]*entity_kind = 'character'/)
  assert.match(migration, /observations may be inserted only by a running scan job/)
  assert.match(migration, /REFERENCES book_analysis_observations\(run_id, id\)/)
  assert.match(migration, /UNIQUE \(run_id, observation_id\)/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS book_analysis_snapshots/)
  assert.match(migration, /analysis stage % is incomplete/)
  assert.match(migration, /publish stage is incomplete/)
  const synthesisMigration = await readFile(
    new URL('../migrations/006_book_analysis_synthesis_and_shadow.sql', import.meta.url),
    'utf8'
  )
  assert.match(synthesisMigration, /'character_role', 'character_age', 'character_gender'/)
  assert.match(synthesisMigration, /'character_profile', 'book_markup', 'validation_report'/)
  assert.match(synthesisMigration, /CREATE TABLE book_analysis_publications/)
  assert.match(synthesisMigration, /channel = 'shadow'/)
  assert.match(synthesisMigration, /book_analysis_artifacts content is immutable/)
  assert.match(synthesisMigration, /book_analysis_publications_immutable/)
})

test('generation cost migration records exact priced and unpriced provider attempts per book', async () => {
  const migration = await readFile(
    new URL('../migrations/018_generation_cost_ledger.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /CREATE TABLE IF NOT EXISTS generation_cost_events/)
  assert.match(migration, /book_edition_id UUID NOT NULL REFERENCES book_editions/)
  assert.match(migration, /analysis_run_id UUID REFERENCES book_analysis_runs/)
  assert.match(migration, /exact_cost_usd NUMERIC\(20, 10\)/)
  assert.match(migration, /cost_source.*response_usage.*response_header/)
})

test('empty-image retry migration requeues only failed independent media jobs', async () => {
  const migration = await readFile(
    new URL('../migrations/012_retry_independent_media_after_empty_image.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /job_type IN \('character_portrait', 'character_audio', 'character_animation'\)/)
  assert.match(migration, /status = 'failed'/)
  assert.match(migration, /last_error_code = 'UNKNOWN'/)
  assert.match(migration, /attempts = 0/)
  assert.doesNotMatch(migration, /character_bundle'/)
  assert.doesNotMatch(migration, /book_markup'/)
})

test('book display identity migration adds durable metadata jobs without replacing raw metadata', async () => {
  const migration = await readFile(
    new URL('../migrations/014_book_display_identity.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /ADD COLUMN display_title TEXT/)
  assert.match(migration, /'book_identity'/)
  assert.doesNotMatch(migration, /DROP COLUMN (title|author)/)
})

test('book scene migration adds durable interval slots and scene media jobs', async () => {
  const migration = await readFile(
    new URL('../migrations/015_book_scenes.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /'scene_image'/)
  assert.match(migration, /CREATE TABLE book_scene_slots/)
  assert.match(migration, /UNIQUE \(markup_version_id, slot_index\)/)
  assert.match(migration, /asset_id UUID REFERENCES media_assets/)
  assert.match(migration, /type IN \([\s\S]*'scene_image'/)
})

test('book genre migration creates and seeds a normalized many-to-many relation', async () => {
  const migration = await readFile(
    new URL('../migrations/016_book_genres.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /CREATE TABLE book_edition_genres/)
  assert.match(migration, /PRIMARY KEY \(book_edition_id, genre\)/)
  assert.match(migration, /WITH source_mapping/)
  assert.match(migration, /'science-fiction'/)
  assert.match(migration, /narra-ru-038-kavkazskij-plennik-pushkin/)
  assert.doesNotMatch(migration, /book_genre|genre_source|\bllm\b/i)
})

test('book content navigation migration stores deterministic reader structure', async () => {
  const migration = await readFile(
    new URL('../migrations/017_book_content_navigation.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /ADD COLUMN content_navigation JSONB/)
  assert.match(migration, /jsonb_typeof\(content_navigation\) = 'object'/)
})

test('book language migration is nullable, backfills both catalog categories and indexes listing', async () => {
  const migration = await readFile(
    new URL('../migrations/020_book_languages.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /ADD COLUMN IF NOT EXISTS language TEXT/)
  assert.match(migration, /catalog_key LIKE 'narra-en-%' THEN 'en'/)
  assert.match(migration, /catalog_key LIKE 'narra-ru-%' THEN 'ru'/)
  assert.match(migration, /language IS NULL OR language ~ '\^\[a-z\]\{2,3\}\$'/)
  assert.match(migration, /ON book_editions \(language, created_at DESC, id DESC\)/)
})

test('catalog replacement migration preserves old editions while hiding them from listings', async () => {
  const migration = await readFile(
    new URL('../migrations/021_catalog_replacements.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /ADD COLUMN IF NOT EXISTS catalog_hidden_at TIMESTAMPTZ/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS replaced_by_book_edition_id UUID/)
  assert.match(migration, /FOREIGN KEY \(replaced_by_book_edition_id\)/)
  assert.match(migration, /REFERENCES book_editions\(id\)/)
  assert.match(migration, /ON DELETE SET NULL/)
  assert.match(migration, /catalog_hidden_at IS NULL/)
  assert.doesNotMatch(migration, /DELETE FROM book_editions/)
})
