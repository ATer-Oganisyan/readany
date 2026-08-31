ALTER TABLE character_media_bundles
  ADD COLUMN source_markup_hash CHAR(64),
  ADD COLUMN media_revision INTEGER NOT NULL DEFAULT 1 CHECK (media_revision >= 1);

UPDATE character_media_bundles AS bundle
SET source_markup_hash = (
  SELECT value.content_hash
  FROM book_analysis_publications AS value
  WHERE value.book_edition_id = bundle.book_edition_id
  ORDER BY value.published_at DESC, value.id DESC
  LIMIT 1
)
WHERE bundle.bundle_version = 'character-bundle-v3'
  AND bundle.source_markup_hash IS NULL
  AND EXISTS (
    SELECT 1 FROM book_analysis_publications AS value
    WHERE value.book_edition_id = bundle.book_edition_id
  );

DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'generation_jobs'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) LIKE '%job_type%' OR
        pg_get_constraintdef(oid) LIKE '%character_key%'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE generation_jobs DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_type_v2 CHECK (
    job_type IN (
      'book_markup', 'character_bundle',
      'character_portrait', 'character_audio', 'character_animation',
      'catalog_cover'
    )
  ),
  ADD CONSTRAINT generation_jobs_character_v2 CHECK (
    (job_type IN ('book_markup', 'catalog_cover') AND character_key IS NULL) OR
    (job_type NOT IN ('book_markup', 'catalog_cover') AND character_key IS NOT NULL)
  );

CREATE INDEX generation_jobs_character_media_revision
  ON generation_jobs (book_edition_id, character_key, target_version, job_type)
  WHERE job_type IN ('character_portrait', 'character_audio', 'character_animation');
