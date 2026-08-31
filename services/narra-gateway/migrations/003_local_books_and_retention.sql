ALTER TABLE book_editions
  ADD COLUMN IF NOT EXISTS source_storage TEXT NOT NULL DEFAULT 'stored';

ALTER TABLE book_editions
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE book_markup_versions
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE character_media_bundles
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS book_object_deletions (
  object_key TEXT PRIMARY KEY,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Private source files from the short-lived upload implementation must not
-- remain in object storage. Queue their deletion before dropping DB metadata.
INSERT INTO book_object_deletions (object_key)
SELECT file.object_key
FROM book_files AS file
JOIN book_editions AS edition ON edition.id = file.book_edition_id
WHERE edition.scope = 'private'
ON CONFLICT (object_key) DO NOTHING;

DELETE FROM book_files AS file
USING book_editions AS edition
WHERE file.book_edition_id = edition.id AND edition.scope = 'private';

UPDATE generation_jobs AS job
SET status = 'failed', last_error_code = 'SOURCE_NOT_STORED',
    locked_at = NULL, locked_by = NULL, lease_token = NULL, updated_at = now()
FROM book_editions AS edition
WHERE job.book_edition_id = edition.id AND edition.scope = 'private'
  AND job.job_type = 'book_markup' AND job.status IN ('queued', 'running');

UPDATE book_editions
SET source_storage = 'local_only',
    expires_at = COALESCE(expires_at, now() + interval '7 days')
WHERE scope = 'private';

UPDATE book_markup_versions AS markup
SET expires_at = edition.expires_at
FROM book_editions AS edition
WHERE edition.id = markup.book_edition_id AND edition.scope = 'private';

UPDATE character_media_bundles AS bundle
SET expires_at = edition.expires_at
FROM book_editions AS edition
WHERE edition.id = bundle.book_edition_id AND edition.scope = 'private';

UPDATE media_assets AS asset
SET expires_at = edition.expires_at
FROM book_editions AS edition
WHERE edition.id = asset.book_edition_id AND edition.scope = 'private';

CREATE INDEX IF NOT EXISTS book_editions_private_expiry
  ON book_editions (expires_at, id)
  WHERE scope = 'private' AND source_storage = 'local_only';

CREATE INDEX IF NOT EXISTS book_object_deletions_pending
  ON book_object_deletions (requested_at, object_key);

ALTER TABLE book_editions
  DROP CONSTRAINT IF EXISTS book_editions_source_storage_check;

ALTER TABLE book_editions
  ADD CONSTRAINT book_editions_source_storage_check CHECK (
    (scope = 'catalog' AND source_storage = 'stored') OR
    (scope = 'private' AND source_storage = 'local_only')
  );
