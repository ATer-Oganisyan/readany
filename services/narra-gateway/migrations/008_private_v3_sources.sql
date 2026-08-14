-- Private source bytes are retained only long enough to run the canonical v3
-- pipeline. Ownership and expires_at continue to gate every reader operation.
ALTER TABLE book_editions
  DROP CONSTRAINT IF EXISTS book_editions_source_storage_check;

ALTER TABLE book_editions
  ADD CONSTRAINT book_editions_source_storage_check CHECK (
    (scope = 'catalog' AND source_storage = 'stored') OR
    (scope = 'private' AND source_storage IN ('local_only', 'temporary'))
  );

DROP INDEX IF EXISTS book_editions_private_expiry;

CREATE INDEX book_editions_private_expiry
  ON book_editions (expires_at, id)
  WHERE scope = 'private';
