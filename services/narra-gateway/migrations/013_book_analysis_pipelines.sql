ALTER TABLE book_analysis_runs
  ADD COLUMN pipeline_id TEXT NOT NULL DEFAULT 'narra'
    CHECK (pipeline_id IN ('narra', 'external')),
  ADD COLUMN pipeline_implementation_version TEXT NOT NULL DEFAULT 'book-analysis-v44',
  ADD COLUMN normalization_version TEXT NOT NULL DEFAULT 'normalized-text-v1',
  ADD COLUMN output_schema_version INTEGER NOT NULL DEFAULT 3
    CHECK (output_schema_version = 3);

ALTER TABLE book_analysis_jobs
  ADD COLUMN pipeline_id TEXT NOT NULL DEFAULT 'narra'
    CHECK (pipeline_id IN ('narra', 'external')),
  ADD COLUMN pipeline_implementation_version TEXT NOT NULL DEFAULT 'book-analysis-v44';

UPDATE book_analysis_jobs AS job
SET pipeline_id = run.pipeline_id,
    pipeline_implementation_version = run.pipeline_implementation_version
FROM book_analysis_runs AS run
WHERE run.id = job.run_id;

ALTER TABLE book_analysis_runs
  DROP CONSTRAINT book_analysis_runs_version_sequence_unique;

ALTER TABLE book_analysis_runs
  ADD CONSTRAINT book_analysis_runs_pipeline_sequence_unique
    UNIQUE (
      book_edition_id, input_hash, pipeline_id, pipeline_implementation_version,
      pipeline_version, prompt_version, normalization_version,
      output_schema_version, run_sequence
    ),
  ADD CONSTRAINT book_analysis_runs_pipeline_identity_unique
    UNIQUE (id, pipeline_id, pipeline_implementation_version);

ALTER TABLE book_analysis_jobs
  ADD CONSTRAINT book_analysis_jobs_pipeline_identity
    FOREIGN KEY (run_id, pipeline_id, pipeline_implementation_version)
    REFERENCES book_analysis_runs (
      id, pipeline_id, pipeline_implementation_version
    ) ON DELETE CASCADE;

CREATE INDEX book_analysis_runs_pipeline_stage
  ON book_analysis_runs (pipeline_id, stage, status);

CREATE INDEX book_analysis_jobs_pipeline_claim
  ON book_analysis_jobs (pipeline_id, stage, priority DESC, available_at, created_at)
  WHERE status = 'queued';

CREATE OR REPLACE FUNCTION reject_book_analysis_pipeline_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.pipeline_id <> OLD.pipeline_id OR
     NEW.pipeline_implementation_version <> OLD.pipeline_implementation_version THEN
    RAISE EXCEPTION 'analysis pipeline identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_book_analysis_run_lineage_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
     NEW.book_edition_id IS DISTINCT FROM OLD.book_edition_id OR
     NEW.input_hash IS DISTINCT FROM OLD.input_hash OR
     NEW.run_sequence IS DISTINCT FROM OLD.run_sequence OR
     NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id OR
     NEW.pipeline_implementation_version IS DISTINCT FROM OLD.pipeline_implementation_version OR
     NEW.pipeline_version IS DISTINCT FROM OLD.pipeline_version OR
     NEW.prompt_version IS DISTINCT FROM OLD.prompt_version OR
     NEW.normalization_version IS DISTINCT FROM OLD.normalization_version OR
     NEW.output_schema_version IS DISTINCT FROM OLD.output_schema_version THEN
    RAISE EXCEPTION 'analysis run lineage is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER book_analysis_run_pipeline_immutable
BEFORE UPDATE OF
  idempotency_key, book_edition_id, input_hash, run_sequence,
  pipeline_id, pipeline_implementation_version,
  pipeline_version, prompt_version, normalization_version, output_schema_version
ON book_analysis_runs
FOR EACH ROW EXECUTE FUNCTION reject_book_analysis_run_lineage_change();

CREATE TRIGGER book_analysis_job_pipeline_immutable
BEFORE UPDATE OF pipeline_id, pipeline_implementation_version
ON book_analysis_jobs
FOR EACH ROW EXECUTE FUNCTION reject_book_analysis_pipeline_change();

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
    AND job.stage = 'scan' AND job.status = 'running'
    AND job.pipeline_id = run.pipeline_id
    AND job.pipeline_implementation_version = run.pipeline_implementation_version
    AND (
      job.chunk_id = NEW.chunk_id OR
      (run.pipeline_id = 'external' AND job.payload->>'scope' = 'book')
    )
  FOR KEY SHARE OF run;
  IF NOT coalesce(allowed, false) THEN
    RAISE EXCEPTION 'observations may be inserted only by a running scan job'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
