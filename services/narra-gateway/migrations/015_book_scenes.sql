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
  ADD CONSTRAINT generation_jobs_type_v4 CHECK (
    job_type IN (
      'book_markup', 'book_identity', 'catalog_cover', 'scene_image',
      'character_bundle', 'character_portrait', 'character_audio', 'character_animation'
    )
  ),
  ADD CONSTRAINT generation_jobs_character_v4 CHECK (
    (job_type IN ('book_markup', 'book_identity', 'catalog_cover', 'scene_image')
      AND character_key IS NULL) OR
    (job_type NOT IN ('book_markup', 'book_identity', 'catalog_cover', 'scene_image')
      AND character_key IS NOT NULL)
  );

DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'media_assets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE media_assets DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_type_v2 CHECK (
    type IN ('primary_portrait', 'greeting_audio', 'idle_animation', 'scene_image')
  );

CREATE TABLE book_scene_slots (
  id UUID PRIMARY KEY,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  markup_version_id UUID NOT NULL REFERENCES book_markup_versions(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  scene_key TEXT NOT NULL,
  slot_index INTEGER NOT NULL CHECK (slot_index >= 0),
  anchor_text_offset BIGINT NOT NULL CHECK (anchor_text_offset >= 0),
  excerpt_start_text_offset BIGINT NOT NULL CHECK (excerpt_start_text_offset >= 0),
  excerpt_end_text_offset BIGINT NOT NULL CHECK (excerpt_end_text_offset > 0),
  job_id UUID NOT NULL REFERENCES generation_jobs(id),
  asset_id UUID REFERENCES media_assets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (excerpt_start_text_offset < excerpt_end_text_offset),
  CHECK (
    excerpt_start_text_offset <= anchor_text_offset AND
    anchor_text_offset < excerpt_end_text_offset
  ),
  UNIQUE (markup_version_id, slot_index),
  UNIQUE (markup_version_id, scene_key),
  UNIQUE (job_id)
);

CREATE INDEX book_scene_slots_edition_anchor
  ON book_scene_slots (book_edition_id, anchor_text_offset);

CREATE INDEX generation_jobs_scene_image
  ON generation_jobs (book_edition_id, target_version)
  WHERE job_type = 'scene_image';
