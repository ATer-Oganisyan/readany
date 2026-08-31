CREATE TABLE IF NOT EXISTS generation_cost_events (
  attempt_id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  analysis_run_id UUID REFERENCES book_analysis_runs(id) ON DELETE SET NULL,
  modality TEXT NOT NULL CHECK (modality IN ('text', 'image')),
  operation TEXT NOT NULL,
  stage TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'not_configured')),
  retry_index INTEGER NOT NULL DEFAULT 0 CHECK (retry_index >= 0),
  http_status INTEGER,
  error_code TEXT,
  input_tokens BIGINT CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens BIGINT CHECK (output_tokens IS NULL OR output_tokens >= 0),
  total_tokens BIGINT CHECK (total_tokens IS NULL OR total_tokens >= 0),
  exact_cost_usd NUMERIC(20, 10) CHECK (exact_cost_usd IS NULL OR exact_cost_usd >= 0),
  cost_source TEXT CHECK (cost_source IS NULL OR cost_source IN ('response_usage', 'response_header')),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generation_cost_events_book_created
  ON generation_cost_events (book_edition_id, created_at, attempt_id);

CREATE INDEX IF NOT EXISTS generation_cost_events_run_created
  ON generation_cost_events (analysis_run_id, created_at, attempt_id)
  WHERE analysis_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS generation_cost_events_operation_created
  ON generation_cost_events (operation, created_at, attempt_id);
