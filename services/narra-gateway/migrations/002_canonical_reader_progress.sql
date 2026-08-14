ALTER TABLE book_markup_versions
  ADD COLUMN IF NOT EXISTS text_length BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'book_markup_text_length_positive'
      AND conrelid = 'book_markup_versions'::regclass
  ) THEN
    ALTER TABLE book_markup_versions
      ADD CONSTRAINT book_markup_text_length_positive
      CHECK (text_length IS NULL OR text_length > 0);
  END IF;
END $$;

ALTER TABLE reader_book_positions
  ADD COLUMN IF NOT EXISTS reading_fraction DOUBLE PRECISION;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reader_book_positions_fraction_range'
      AND conrelid = 'reader_book_positions'::regclass
  ) THEN
    ALTER TABLE reader_book_positions
      ADD CONSTRAINT reader_book_positions_fraction_range
      CHECK (reading_fraction IS NULL OR (
        reading_fraction >= 0 AND reading_fraction <= 1
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS book_markup_analysis_version
  ON book_markup_versions (book_edition_id, analysis_version)
  WHERE status = 'published';
