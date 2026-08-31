ALTER TABLE book_analysis_runs
  ADD COLUMN content_navigation JSONB;

ALTER TABLE book_analysis_runs
  ADD CONSTRAINT book_analysis_runs_content_navigation_object
  CHECK (
    content_navigation IS NULL OR
    jsonb_typeof(content_navigation) = 'object'
  );
