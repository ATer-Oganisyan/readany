CREATE TABLE book_tts_markup_jobs (
  id UUID PRIMARY KEY,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  source_publication_id UUID NOT NULL REFERENCES book_analysis_publications(id) ON DELETE CASCADE,
  source_markup_content_hash CHAR(64) NOT NULL CHECK (source_markup_content_hash ~ '^[0-9a-f]{64}$'),
  normalized_text_hash CHAR(64) NOT NULL CHECK (normalized_text_hash ~ '^[0-9a-f]{64}$'),
  analysis_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_publication_id, analysis_version),
  CHECK (
    (status = 'running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'running' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX book_tts_markup_jobs_claim
  ON book_tts_markup_jobs (status, created_at, id);

CREATE INDEX book_tts_markup_jobs_edition
  ON book_tts_markup_jobs (book_edition_id, created_at DESC);

CREATE TABLE book_tts_markup_publications (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL UNIQUE REFERENCES book_tts_markup_jobs(id) ON DELETE CASCADE,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  source_publication_id UUID NOT NULL REFERENCES book_analysis_publications(id) ON DELETE CASCADE,
  analysis_version TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  normalized_text_hash CHAR(64) NOT NULL CHECK (normalized_text_hash ~ '^[0-9a-f]{64}$'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_publication_id, analysis_version),
  UNIQUE (book_edition_id, revision)
);

CREATE INDEX book_tts_markup_publications_edition
  ON book_tts_markup_publications (book_edition_id, published_at DESC, id DESC);

CREATE TRIGGER book_tts_markup_publications_immutable
BEFORE UPDATE ON book_tts_markup_publications
FOR EACH ROW EXECUTE FUNCTION reject_book_analysis_immutable_update();
