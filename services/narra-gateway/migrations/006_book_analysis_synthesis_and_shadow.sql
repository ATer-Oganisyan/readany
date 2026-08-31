DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'book_analysis_observations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%observation_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE book_analysis_observations DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE book_analysis_observations
  ADD CONSTRAINT book_analysis_observations_type_v2 CHECK (
    observation_type IN (
      'character_mention', 'character_alias', 'character_action',
      'character_dialogue', 'character_trait', 'character_appearance',
      'character_role', 'character_age', 'character_gender',
      'event', 'location', 'relationship'
    )
  ),
  ADD CONSTRAINT book_analysis_observations_kind_v2 CHECK (
    (observation_type IN (
      'character_mention', 'character_alias', 'character_action',
      'character_dialogue', 'character_trait', 'character_appearance',
      'character_role', 'character_age', 'character_gender'
    ) AND entity_kind = 'character') OR
    (observation_type = 'event' AND entity_kind = 'event') OR
    (observation_type = 'location' AND entity_kind = 'location') OR
    (observation_type = 'relationship' AND entity_kind = 'relationship')
  );

DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'book_analysis_artifacts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%artifact_kind%'
  LOOP
    EXECUTE format(
      'ALTER TABLE book_analysis_artifacts DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE book_analysis_artifacts
  ADD CONSTRAINT book_analysis_artifacts_kind_v2 CHECK (
    artifact_kind IN ('character_profile', 'book_markup', 'validation_report')
  );

CREATE OR REPLACE FUNCTION enforce_book_analysis_artifact_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.run_id, NEW.snapshot_id, NEW.artifact_kind, NEW.artifact_key,
    NEW.schema_version, NEW.content_hash, NEW.data, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.run_id, OLD.snapshot_id, OLD.artifact_kind, OLD.artifact_key,
    OLD.schema_version, OLD.content_hash, OLD.data, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'book_analysis_artifacts content is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('valid', 'invalid')) OR
    (OLD.status = 'valid' AND NEW.status = 'published'
      AND OLD.artifact_kind = 'book_markup')
  ) THEN
    RAISE EXCEPTION 'invalid book_analysis_artifacts status transition'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = OLD.status AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'book_analysis_artifacts publication timestamp is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER book_analysis_artifacts_immutable_content
BEFORE UPDATE ON book_analysis_artifacts
FOR EACH ROW EXECUTE FUNCTION enforce_book_analysis_artifact_update();

CREATE TABLE book_analysis_publications (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL UNIQUE REFERENCES book_analysis_runs(id) ON DELETE CASCADE,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES book_analysis_artifacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'shadow' CHECK (channel = 'shadow'),
  analysis_version TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, channel),
  UNIQUE (artifact_id, channel)
);

CREATE INDEX book_analysis_publications_edition
  ON book_analysis_publications (book_edition_id, channel, published_at DESC);

CREATE TRIGGER book_analysis_publications_immutable
BEFORE UPDATE ON book_analysis_publications
FOR EACH ROW EXECUTE FUNCTION reject_book_analysis_immutable_update();
