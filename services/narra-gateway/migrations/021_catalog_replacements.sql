ALTER TABLE book_editions
  ADD COLUMN IF NOT EXISTS catalog_hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replaced_by_book_edition_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'book_editions_replaced_by_foreign_key'
  ) THEN
    ALTER TABLE book_editions
      ADD CONSTRAINT book_editions_replaced_by_foreign_key
      FOREIGN KEY (replaced_by_book_edition_id)
      REFERENCES book_editions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS book_editions_catalog_visible_index
  ON book_editions (created_at DESC, id DESC)
  WHERE scope = 'catalog'
    AND status IN ('base_ready', 'published')
    AND catalog_hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS book_editions_replaced_by_index
  ON book_editions (replaced_by_book_edition_id)
  WHERE replaced_by_book_edition_id IS NOT NULL;
