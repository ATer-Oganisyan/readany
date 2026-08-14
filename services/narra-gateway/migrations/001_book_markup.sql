CREATE TABLE IF NOT EXISTS book_editions (
  id UUID PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('catalog', 'private')),
  owner_subject_id UUID,
  catalog_key TEXT,
  content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'draft', 'uploading', 'extracting', 'marking_up',
      'generating_portraits', 'base_ready', 'published', 'failed'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'catalog' AND owner_subject_id IS NULL AND catalog_key IS NOT NULL) OR
    (scope = 'private' AND owner_subject_id IS NOT NULL AND catalog_key IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS book_editions_catalog_key_unique
  ON book_editions (catalog_key)
  WHERE scope = 'catalog';

CREATE UNIQUE INDEX IF NOT EXISTS book_editions_catalog_hash_unique
  ON book_editions (content_sha256)
  WHERE scope = 'catalog';

CREATE UNIQUE INDEX IF NOT EXISTS book_editions_private_owner_hash_unique
  ON book_editions (owner_subject_id, content_sha256)
  WHERE scope = 'private';

CREATE TABLE IF NOT EXISTS book_files (
  book_edition_id UUID PRIMARY KEY REFERENCES book_editions(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('staging', 'ready', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS book_markup_versions (
  id UUID PRIMARY KEY,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  analysis_version TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'published', 'failed')),
  input_hash CHAR(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  UNIQUE (book_edition_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS book_markup_one_published_revision
  ON book_markup_versions (book_edition_id)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS book_characters (
  id UUID PRIMARY KEY,
  markup_version_id UUID NOT NULL REFERENCES book_markup_versions(id) ON DELETE CASCADE,
  character_key TEXT NOT NULL CHECK (character_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  first_appearance_text_offset BIGINT NOT NULL CHECK (first_appearance_text_offset >= 0),
  warmup_text_offset BIGINT NOT NULL CHECK (warmup_text_offset >= 0),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (warmup_text_offset <= first_appearance_text_offset),
  UNIQUE (markup_version_id, character_key)
);

CREATE INDEX IF NOT EXISTS book_characters_warmup_offset
  ON book_characters (markup_version_id, warmup_text_offset);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id UUID PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  job_type TEXT NOT NULL CHECK (job_type IN ('book_markup', 'character_bundle')),
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  character_key TEXT,
  target_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  priority INTEGER NOT NULL DEFAULT 50,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  last_error_code TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  lease_token UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (job_type = 'book_markup' AND character_key IS NULL) OR
    (job_type = 'character_bundle' AND character_key IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS generation_jobs_claim_queue
  ON generation_jobs (priority DESC, available_at, created_at)
  WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS character_media_bundles (
  id UUID PRIMARY KEY,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  character_key TEXT NOT NULL,
  bundle_version TEXT NOT NULL,
  job_id UUID REFERENCES generation_jobs(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  UNIQUE (book_edition_id, character_key, bundle_version)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL CHECK (visibility IN ('catalog', 'private')),
  type TEXT NOT NULL CHECK (
    type IN ('primary_portrait', 'greeting_audio', 'idle_animation')
  ),
  object_key TEXT NOT NULL UNIQUE,
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  status TEXT NOT NULL CHECK (status IN ('staging', 'ready', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS character_bundle_assets (
  bundle_id UUID NOT NULL REFERENCES character_media_bundles(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (
    asset_type IN ('primary_portrait', 'greeting_audio', 'idle_animation')
  ),
  asset_id UUID NOT NULL REFERENCES media_assets(id),
  PRIMARY KEY (bundle_id, asset_type)
);

CREATE TABLE IF NOT EXISTS reader_book_positions (
  subject_id UUID NOT NULL,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  text_offset BIGINT NOT NULL CHECK (text_offset >= 0),
  chapter_key TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, book_edition_id)
);
