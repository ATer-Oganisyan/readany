CREATE TABLE book_search_indexes (
  id UUID PRIMARY KEY,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES book_analysis_runs(id) ON DELETE CASCADE,
  source_content_hash CHAR(64) NOT NULL CHECK (source_content_hash ~ '^[0-9a-f]{64}$'),
  index_version TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dimensions INTEGER NOT NULL CHECK (
    embedding_dimensions BETWEEN 1 AND 4096
  ),
  state TEXT NOT NULL DEFAULT 'prepared' CHECK (
    state IN (
      'prepared', 'lexical_ready', 'vector_partial', 'vector_ready',
      'graph_ready', 'story_arcs_ready'
    )
  ),
  is_active BOOLEAN NOT NULL DEFAULT false,
  chunk_total INTEGER NOT NULL CHECK (chunk_total > 0),
  lexical_chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (lexical_chunk_count >= 0),
  vector_chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (vector_chunk_count >= 0),
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (lexical_chunk_count <= chunk_total),
  CHECK (vector_chunk_count <= chunk_total),
  UNIQUE (
    book_edition_id, run_id, index_version, embedding_model, embedding_dimensions
  ),
  UNIQUE (id, run_id)
);

CREATE UNIQUE INDEX book_search_indexes_one_active
  ON book_search_indexes (book_edition_id)
  WHERE is_active;

CREATE INDEX book_search_indexes_book_created
  ON book_search_indexes (book_edition_id, created_at DESC);

CREATE TABLE book_search_chunks (
  index_id UUID NOT NULL,
  run_id UUID NOT NULL,
  analysis_chunk_id UUID NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  chapter_key TEXT,
  core_start_offset BIGINT NOT NULL CHECK (core_start_offset >= 0),
  core_end_offset BIGINT NOT NULL CHECK (core_end_offset > core_start_offset),
  context_start_offset BIGINT NOT NULL CHECK (context_start_offset >= 0),
  context_end_offset BIGINT NOT NULL CHECK (context_end_offset > context_start_offset),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  core_text TEXT NOT NULL,
  search_document TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', core_text)
  ) STORED,
  embedding DOUBLE PRECISION[],
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  lexical_indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  vector_indexed_at TIMESTAMPTZ,
  PRIMARY KEY (index_id, analysis_chunk_id),
  UNIQUE (index_id, ordinal),
  FOREIGN KEY (index_id, run_id)
    REFERENCES book_search_indexes(id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, analysis_chunk_id)
    REFERENCES book_analysis_chunks(run_id, id) ON DELETE CASCADE,
  CHECK (
    (embedding IS NULL AND embedding_model IS NULL
      AND embedding_dimensions IS NULL AND vector_indexed_at IS NULL) OR
    (embedding IS NOT NULL AND embedding_model IS NOT NULL
      AND embedding_dimensions IS NOT NULL AND vector_indexed_at IS NOT NULL
      AND cardinality(embedding) = embedding_dimensions)
  )
);

CREATE INDEX book_search_chunks_lexical
  ON book_search_chunks USING GIN (search_document);

CREATE INDEX book_search_chunks_spoiler_boundary
  ON book_search_chunks (index_id, core_end_offset, ordinal);

CREATE TABLE book_search_jobs (
  id UUID PRIMARY KEY,
  index_id UUID NOT NULL REFERENCES book_search_indexes(id) ON DELETE CASCADE,
  analysis_chunk_id UUID,
  job_type TEXT NOT NULL CHECK (
    job_type IN ('lexical', 'embedding', 'graph', 'story_arc')
  ),
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
  CHECK (
    (job_type IN ('lexical', 'embedding') AND analysis_chunk_id IS NOT NULL) OR
    (job_type IN ('graph', 'story_arc') AND analysis_chunk_id IS NULL)
  ),
  CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  CHECK (
    (status = 'running' AND locked_at IS NOT NULL
      AND lease_expires_at IS NOT NULL AND locked_by IS NOT NULL
      AND lease_token IS NOT NULL) OR
    status <> 'running'
  ),
  UNIQUE (index_id, job_type, analysis_chunk_id)
);

CREATE INDEX book_search_jobs_claim
  ON book_search_jobs (job_type, priority DESC, available_at, created_at)
  WHERE status IN ('queued', 'running');

CREATE TABLE book_ai_usage (
  id UUID PRIMARY KEY,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  search_index_id UUID REFERENCES book_search_indexes(id) ON DELETE SET NULL,
  search_job_id UUID REFERENCES book_search_jobs(id) ON DELETE SET NULL,
  operation TEXT NOT NULL CHECK (
    operation IN ('embedding_index', 'embedding_query', 'story_arc', 'rag_answer')
  ),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_units INTEGER NOT NULL DEFAULT 0 CHECK (input_units >= 0),
  output_units INTEGER NOT NULL DEFAULT 0 CHECK (output_units >= 0),
  request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count >= 1),
  estimated_cost_usd NUMERIC(12, 8) CHECK (estimated_cost_usd >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX book_ai_usage_book_created
  ON book_ai_usage (book_edition_id, created_at DESC);

COMMENT ON COLUMN book_search_chunks.embedding IS
  'Local implementation uses exact cosine over float arrays. Deployment migration replaces this with pgvector/HNSW without changing worker or API contracts.';
