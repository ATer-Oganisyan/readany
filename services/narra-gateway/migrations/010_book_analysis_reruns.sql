ALTER TABLE book_analysis_runs
  ADD COLUMN run_sequence INTEGER NOT NULL DEFAULT 1 CHECK (run_sequence >= 1),
  ADD COLUMN restarted_from_run_id UUID;

DO $$
DECLARE
  previous_unique_constraint name;
BEGIN
  SELECT constraint_row.conname
    INTO previous_unique_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'book_analysis_runs'::regclass
    AND constraint_row.contype = 'u'
    AND pg_get_constraintdef(constraint_row.oid) =
      'UNIQUE (book_edition_id, input_hash, pipeline_version, prompt_version)'
  LIMIT 1;

  IF previous_unique_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE book_analysis_runs DROP CONSTRAINT %I',
      previous_unique_constraint
    );
  END IF;
END;
$$;

ALTER TABLE book_analysis_runs
  ADD CONSTRAINT book_analysis_runs_version_sequence_unique
    UNIQUE (book_edition_id, input_hash, pipeline_version, prompt_version, run_sequence),
  ADD CONSTRAINT book_analysis_runs_restart_lineage
    FOREIGN KEY (restarted_from_run_id)
    REFERENCES book_analysis_runs(id) ON DELETE SET NULL;

CREATE INDEX book_analysis_runs_edition_sequence
  ON book_analysis_runs (book_edition_id, run_sequence DESC, created_at DESC);
