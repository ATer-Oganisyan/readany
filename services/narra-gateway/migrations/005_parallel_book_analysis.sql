CREATE TABLE IF NOT EXISTS book_analysis_runs (
  id UUID PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  pipeline_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash CHAR(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  normalized_text_object_key TEXT UNIQUE,
  normalized_text_hash CHAR(64) CHECK (
    normalized_text_hash IS NULL OR normalized_text_hash ~ '^[0-9a-f]{64}$'
  ),
  text_length BIGINT CHECK (text_length IS NULL OR text_length > 0),
  sections JSONB CHECK (sections IS NULL OR jsonb_typeof(sections) = 'array'),
  stage TEXT NOT NULL DEFAULT 'prepare' CHECK (
    stage IN ('prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish')
  ),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'ready', 'failed', 'cancelled')
  ),
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK (status <> 'ready' OR stage = 'publish'),
  CHECK (completed_at IS NULL OR status IN ('ready', 'failed', 'cancelled')),
  CHECK (
    (normalized_text_object_key IS NULL AND normalized_text_hash IS NULL
      AND text_length IS NULL AND sections IS NULL) OR
    (normalized_text_object_key IS NOT NULL AND normalized_text_hash IS NOT NULL
      AND text_length IS NOT NULL AND sections IS NOT NULL)
  ),
  UNIQUE (book_edition_id, input_hash, pipeline_version, prompt_version)
);

CREATE INDEX IF NOT EXISTS book_analysis_runs_active
  ON book_analysis_runs (stage, status, updated_at)
  WHERE status IN ('queued', 'running', 'failed');

CREATE TABLE IF NOT EXISTS book_analysis_chunks (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES book_analysis_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  chapter_key TEXT,
  core_start_offset BIGINT NOT NULL CHECK (core_start_offset >= 0),
  core_end_offset BIGINT NOT NULL CHECK (core_end_offset > 0),
  context_start_offset BIGINT NOT NULL CHECK (context_start_offset >= 0),
  context_end_offset BIGINT NOT NULL CHECK (context_end_offset > 0),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (context_start_offset <= core_start_offset),
  CHECK (core_start_offset < core_end_offset),
  CHECK (core_end_offset <= context_end_offset),
  UNIQUE (run_id, ordinal),
  UNIQUE (run_id, core_start_offset, core_end_offset),
  UNIQUE (run_id, id)
);

CREATE INDEX IF NOT EXISTS book_analysis_chunks_order
  ON book_analysis_chunks (run_id, ordinal);

CREATE TABLE IF NOT EXISTS book_analysis_jobs (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES book_analysis_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (
    stage IN ('prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish')
  ),
  shard_key TEXT NOT NULL,
  chunk_id UUID,
  required BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'ready', 'failed', 'cancelled')
  ),
  priority INTEGER NOT NULL DEFAULT 50,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  result JSONB,
  last_error_code TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  locked_by TEXT,
  lease_token UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((stage = 'scan') = (chunk_id IS NOT NULL)),
  CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  CHECK (
    (status = 'running' AND locked_at IS NOT NULL AND lease_expires_at IS NOT NULL
      AND locked_by IS NOT NULL AND lease_token IS NOT NULL) OR
    (status <> 'running')
  ),
  UNIQUE (run_id, stage, shard_key),
  UNIQUE (run_id, id),
  FOREIGN KEY (run_id, chunk_id)
    REFERENCES book_analysis_chunks(run_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS book_analysis_jobs_claim
  ON book_analysis_jobs (stage, priority DESC, available_at, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS book_analysis_jobs_expired_lease
  ON book_analysis_jobs (lease_expires_at, stage)
  WHERE status = 'running';

CREATE TABLE IF NOT EXISTS book_analysis_observations (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  chunk_id UUID NOT NULL,
  source_job_id UUID NOT NULL,
  extractor_version TEXT NOT NULL,
  observation_key TEXT NOT NULL,
  observation_type TEXT NOT NULL CHECK (
    observation_type IN (
      'character_mention', 'character_alias', 'character_action',
      'character_dialogue', 'character_trait', 'character_appearance',
      'event', 'location', 'relationship'
    )
  ),
  entity_kind TEXT NOT NULL CHECK (
    entity_kind IN ('character', 'event', 'location', 'relationship')
  ),
  entity_candidate TEXT NOT NULL,
  related_entity_candidates JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(related_entity_candidates) = 'array'
  ),
  fact TEXT NOT NULL,
  evidence_quote TEXT NOT NULL,
  evidence_start_offset BIGINT NOT NULL CHECK (evidence_start_offset >= 0),
  evidence_end_offset BIGINT NOT NULL CHECK (evidence_end_offset > 0),
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(btrim(entity_candidate)) > 0),
  CHECK (length(btrim(fact)) > 0),
  CHECK (length(evidence_quote) > 0),
  CHECK (evidence_start_offset < evidence_end_offset),
  CHECK (
    (observation_type IN (
      'character_mention', 'character_alias', 'character_action',
      'character_dialogue', 'character_trait', 'character_appearance'
    ) AND entity_kind = 'character') OR
    (observation_type = 'event' AND entity_kind = 'event') OR
    (observation_type = 'location' AND entity_kind = 'location') OR
    (observation_type = 'relationship' AND entity_kind = 'relationship')
  ),
  UNIQUE (run_id, chunk_id, extractor_version, observation_key),
  UNIQUE (run_id, id),
  FOREIGN KEY (run_id, chunk_id)
    REFERENCES book_analysis_chunks(run_id, id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, source_job_id)
    REFERENCES book_analysis_jobs(run_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS book_analysis_observations_entity
  ON book_analysis_observations (run_id, entity_kind, entity_candidate);

CREATE INDEX IF NOT EXISTS book_analysis_observations_evidence
  ON book_analysis_observations (run_id, evidence_start_offset, evidence_end_offset);

CREATE OR REPLACE FUNCTION enforce_book_analysis_observation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed BOOLEAN;
BEGIN
  SELECT true INTO allowed
  FROM book_analysis_runs AS run
  JOIN book_analysis_jobs AS job
    ON job.run_id = run.id AND job.id = NEW.source_job_id
  WHERE run.id = NEW.run_id AND run.stage = 'scan' AND run.status = 'running'
    AND job.stage = 'scan' AND job.chunk_id = NEW.chunk_id
    AND job.status = 'running'
  FOR KEY SHARE OF run;
  IF NOT coalesce(allowed, false) THEN
    RAISE EXCEPTION 'observations may be inserted only by a running scan job'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER book_analysis_observation_insert_state
BEFORE INSERT ON book_analysis_observations
FOR EACH ROW EXECUTE FUNCTION enforce_book_analysis_observation_insert();

CREATE TABLE IF NOT EXISTS book_analysis_entities (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES book_analysis_runs(id) ON DELETE CASCADE,
  entity_key TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK (
    entity_kind IN ('character', 'event', 'location', 'relationship')
  ),
  canonical_name TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases) = 'array'),
  resolution_status TEXT NOT NULL DEFAULT 'candidate' CHECK (
    resolution_status IN ('candidate', 'confirmed', 'rejected')
  ),
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(btrim(entity_key)) > 0),
  CHECK (length(btrim(canonical_name)) > 0),
  UNIQUE (run_id, entity_key),
  UNIQUE (run_id, id)
);

CREATE TABLE IF NOT EXISTS book_analysis_entity_evidence (
  run_id UUID NOT NULL,
  entity_id UUID NOT NULL,
  observation_id UUID NOT NULL REFERENCES book_analysis_observations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, observation_id),
  UNIQUE (run_id, observation_id),
  FOREIGN KEY (run_id, entity_id)
    REFERENCES book_analysis_entities(run_id, id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, observation_id)
    REFERENCES book_analysis_observations(run_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS book_analysis_snapshots (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES book_analysis_runs(id) ON DELETE CASCADE,
  snapshot_version INTEGER NOT NULL CHECK (snapshot_version >= 1),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  evidence_count INTEGER NOT NULL CHECK (evidence_count >= 0),
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, snapshot_version),
  UNIQUE (run_id, content_hash),
  UNIQUE (run_id, id)
);

CREATE TABLE IF NOT EXISTS book_analysis_artifacts (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  artifact_kind TEXT NOT NULL CHECK (
    artifact_kind IN ('book_markup', 'validation_report')
  ),
  artifact_key TEXT NOT NULL DEFAULT 'primary',
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'valid', 'invalid', 'published')
  ),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  CHECK ((status = 'published') = (published_at IS NOT NULL)),
  UNIQUE (run_id, artifact_kind, artifact_key),
  FOREIGN KEY (run_id, snapshot_id)
    REFERENCES book_analysis_snapshots(run_id, id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION reject_book_analysis_immutable_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER book_analysis_observations_immutable
BEFORE UPDATE ON book_analysis_observations
FOR EACH ROW EXECUTE FUNCTION reject_book_analysis_immutable_update();

CREATE TRIGGER book_analysis_snapshots_immutable
BEFORE UPDATE ON book_analysis_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_book_analysis_immutable_update();

CREATE OR REPLACE FUNCTION enforce_book_analysis_run_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_stage_index INTEGER;
  new_stage_index INTEGER;
  required_job_count BIGINT;
  incomplete_job_count BIGINT;
BEGIN
  IF OLD.status IN ('ready', 'cancelled') THEN
    RAISE EXCEPTION '% analysis runs are immutable', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.stage <> OLD.stage THEN
    IF OLD.status <> 'running' OR NEW.status <> 'running' THEN
      RAISE EXCEPTION 'stage changes require a running analysis run'
        USING ERRCODE = 'check_violation';
    END IF;
    old_stage_index := array_position(
      ARRAY['prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish'],
      OLD.stage
    );
    new_stage_index := array_position(
      ARRAY['prepare', 'scan', 'resolve', 'synthesize', 'validate', 'publish'],
      NEW.stage
    );
    IF new_stage_index <> old_stage_index + 1 THEN
      RAISE EXCEPTION 'analysis stages must advance exactly one step'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*), count(*) FILTER (WHERE status <> 'ready')
      INTO required_job_count, incomplete_job_count
    FROM book_analysis_jobs
    WHERE run_id = OLD.id AND stage = OLD.stage AND required;
    IF required_job_count = 0 OR incomplete_job_count > 0 THEN
      RAISE EXCEPTION 'analysis stage % is incomplete', OLD.stage
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.status = 'queued' AND NEW.status NOT IN ('queued', 'running', 'cancelled') THEN
    RAISE EXCEPTION 'unsupported queued analysis transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.status = 'running' AND NEW.status NOT IN ('running', 'ready', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'unsupported running analysis transition'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.status = 'failed' AND NEW.status NOT IN ('failed', 'queued', 'cancelled') THEN
    RAISE EXCEPTION 'unsupported failed analysis transition'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'ready' AND OLD.status <> 'ready' THEN
    IF OLD.status <> 'running' OR NEW.stage <> 'publish' THEN
      RAISE EXCEPTION 'only a running publish stage can become ready'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*), count(*) FILTER (WHERE status <> 'ready')
      INTO required_job_count, incomplete_job_count
    FROM book_analysis_jobs
    WHERE run_id = OLD.id AND stage = 'publish' AND required;
    IF required_job_count = 0 OR incomplete_job_count > 0 THEN
      RAISE EXCEPTION 'publish stage is incomplete'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.updated_at := now();
  IF OLD.status = 'queued' AND NEW.status = 'running' AND NEW.started_at IS NULL THEN
    NEW.started_at := now();
  END IF;
  IF NEW.status IN ('ready', 'failed', 'cancelled') AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  ELSIF NEW.status IN ('queued', 'running') THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER book_analysis_run_transition
BEFORE UPDATE OF stage, status ON book_analysis_runs
FOR EACH ROW EXECUTE FUNCTION enforce_book_analysis_run_transition();
