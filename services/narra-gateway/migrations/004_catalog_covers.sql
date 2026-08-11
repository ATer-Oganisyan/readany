CREATE TABLE IF NOT EXISTS catalog_book_covers (
  book_edition_id UUID PRIMARY KEY REFERENCES book_editions(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  status TEXT NOT NULL CHECK (status IN ('staging', 'ready', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_book_covers_ready
  ON catalog_book_covers (book_edition_id)
  WHERE status = 'ready';
