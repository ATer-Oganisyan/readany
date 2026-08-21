ALTER TABLE book_editions
  ADD COLUMN display_title TEXT,
  ADD COLUMN display_author TEXT,
  ADD COLUMN identity_version TEXT,
  ADD COLUMN identity_source TEXT CHECK (
    identity_source IS NULL OR identity_source IN ('deterministic', 'llm')
  ),
  ADD COLUMN identity_updated_at TIMESTAMPTZ;

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
  ADD CONSTRAINT generation_jobs_type_v3 CHECK (
    job_type IN (
      'book_markup', 'book_identity', 'catalog_cover', 'character_bundle',
      'character_portrait', 'character_audio', 'character_animation'
    )
  ),
  ADD CONSTRAINT generation_jobs_character_v3 CHECK (
    (job_type IN ('book_markup', 'book_identity', 'catalog_cover') AND character_key IS NULL) OR
    (job_type NOT IN ('book_markup', 'book_identity', 'catalog_cover') AND character_key IS NOT NULL)
  );

CREATE INDEX generation_jobs_book_identity
  ON generation_jobs (book_edition_id, target_version)
  WHERE job_type = 'book_identity';
