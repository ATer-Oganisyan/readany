ALTER TABLE book_editions
  ADD COLUMN IF NOT EXISTS language TEXT;

UPDATE book_editions
SET language = CASE
  WHEN catalog_key LIKE 'narra-en-%' THEN 'en'
  WHEN catalog_key LIKE 'narra-ru-%' THEN 'ru'
  WHEN catalog_key LIKE 'eval-%' THEN 'ru'
  WHEN catalog_key IN (
    'bratya-karamazovy',
    'crime-and-punishment',
    'mednyj-vsadnik',
    'pushkin-krasavitse',
    'seagull',
    'zapiski-institutki'
  ) THEN 'ru'
  ELSE NULL
END
WHERE scope = 'catalog' AND language IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'book_editions_language_base_code'
      AND conrelid = 'book_editions'::regclass
  ) THEN
    ALTER TABLE book_editions
      ADD CONSTRAINT book_editions_language_base_code
      CHECK (language IS NULL OR language ~ '^[a-z]{2,3}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS book_editions_catalog_language_created_idx
  ON book_editions (language, created_at DESC, id DESC)
  WHERE scope = 'catalog' AND status IN ('base_ready', 'published');
