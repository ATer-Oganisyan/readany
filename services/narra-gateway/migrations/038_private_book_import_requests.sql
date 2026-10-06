CREATE TABLE IF NOT EXISTS book_import_requests (
  owner_subject_id UUID NOT NULL,
  request_id UUID NOT NULL,
  request_fingerprint CHAR(64) NOT NULL CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  book_edition_id UUID NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN ('private', 'catalog')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_subject_id, request_id)
);

CREATE INDEX IF NOT EXISTS book_import_requests_edition_created
  ON book_import_requests (book_edition_id, created_at DESC);
