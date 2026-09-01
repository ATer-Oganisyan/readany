CREATE TABLE book_character_corrections (
  book_edition_id UUID PRIMARY KEY REFERENCES book_editions(id) ON DELETE CASCADE,
  base_markup_version_id UUID NOT NULL REFERENCES book_markup_versions(id) ON DELETE CASCADE,
  base_publication_id UUID NOT NULL REFERENCES book_analysis_publications(id) ON DELETE CASCADE,
  base_content_hash CHAR(64) NOT NULL CHECK (base_content_hash ~ '^[0-9a-f]{64}$'),
  correction_version INTEGER NOT NULL CHECK (correction_version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'enabled', 'disabled')),
  document JSONB NOT NULL CHECK (
    jsonb_typeof(document) = 'object' AND
    document->>'contractVersion' = 'book-character-correction-v1'
  ),
  document_hash CHAR(64) NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  validation JSONB NOT NULL CHECK (jsonb_typeof(validation) = 'object'),
  created_by TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 120),
  updated_by TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 120),
  enabled_by TEXT CHECK (enabled_by IS NULL OR length(enabled_by) BETWEEN 1 AND 120),
  disabled_by TEXT CHECK (disabled_by IS NULL OR length(disabled_by) BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  CHECK (
    (status = 'enabled' AND enabled_at IS NOT NULL AND enabled_by IS NOT NULL) OR
    status <> 'enabled'
  )
);

CREATE INDEX book_character_corrections_enabled
  ON book_character_corrections (base_markup_version_id, base_publication_id, base_content_hash)
  WHERE status = 'enabled';

