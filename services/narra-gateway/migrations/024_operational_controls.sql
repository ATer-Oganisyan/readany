CREATE TABLE generation_queue_operations (
  id UUID PRIMARY KEY,
  selector JSONB NOT NULL CHECK (jsonb_typeof(selector) = 'object'),
  reason_code TEXT NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  operator_id TEXT NOT NULL CHECK (length(operator_id) BETWEEN 1 AND 120),
  resume_reason_code TEXT CHECK (resume_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  resume_operator_id TEXT CHECK (length(resume_operator_id) BETWEEN 1 AND 120),
  paused_count INTEGER NOT NULL DEFAULT 0 CHECK (paused_count >= 0),
  resumed_count INTEGER NOT NULL DEFAULT 0 CHECK (resumed_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_resumed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

ALTER TABLE generation_jobs
  ADD COLUMN operator_pause_id UUID REFERENCES generation_queue_operations(id) ON DELETE SET NULL,
  ADD COLUMN operator_paused_at TIMESTAMPTZ,
  ADD COLUMN first_download_at TIMESTAMPTZ,
  ADD CONSTRAINT generation_jobs_operator_pause_consistent CHECK (
    (operator_pause_id IS NULL AND operator_paused_at IS NULL) OR
    (operator_pause_id IS NOT NULL AND operator_paused_at IS NOT NULL)
  );

CREATE INDEX generation_jobs_operator_paused
  ON generation_jobs (operator_pause_id, updated_at)
  WHERE operator_pause_id IS NOT NULL;

CREATE TABLE worker_heartbeats (
  worker_id TEXT PRIMARY KEY CHECK (length(worker_id) BETWEEN 1 AND 200),
  worker_type TEXT NOT NULL CHECK (worker_type ~ '^[a-z][a-z0-9-]{1,79}$'),
  build_version TEXT NOT NULL CHECK (length(build_version) BETWEEN 1 AND 120),
  state TEXT NOT NULL CHECK (state ~ '^[a-z][a-z0-9_-]{1,39}$'),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX worker_heartbeats_active
  ON worker_heartbeats (worker_type, build_version, last_seen_at DESC);
