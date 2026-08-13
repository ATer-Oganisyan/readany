ALTER TABLE reader_book_positions
  ADD COLUMN IF NOT EXISTS section_index INTEGER,
  ADD COLUMN IF NOT EXISTS section_fraction DOUBLE PRECISION;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reader_book_positions_section_index_nonnegative'
      AND conrelid = 'reader_book_positions'::regclass
  ) THEN
    ALTER TABLE reader_book_positions
      ADD CONSTRAINT reader_book_positions_section_index_nonnegative
      CHECK (section_index IS NULL OR section_index >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reader_book_positions_section_fraction_range'
      AND conrelid = 'reader_book_positions'::regclass
  ) THEN
    ALTER TABLE reader_book_positions
      ADD CONSTRAINT reader_book_positions_section_fraction_range
      CHECK (section_fraction IS NULL OR (
        section_fraction >= 0 AND section_fraction <= 1
      ));
  END IF;
END $$;
