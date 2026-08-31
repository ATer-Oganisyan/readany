CREATE TABLE IF NOT EXISTS book_analysis_retry_requests (
  owner_subject_id UUID NOT NULL,
  request_id UUID NOT NULL,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  run_id UUID REFERENCES book_analysis_runs(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('created', 'active', 'ready')),
  run_created BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_subject_id, request_id)
);

CREATE INDEX IF NOT EXISTS book_analysis_retry_requests_edition_created
  ON book_analysis_retry_requests (book_edition_id, created_at DESC);
