WITH retried AS (
  UPDATE generation_jobs
  SET status = 'queued', attempts = 0, last_error_code = NULL,
      available_at = now(), locked_at = NULL, locked_by = NULL,
      lease_token = NULL, updated_at = now()
  WHERE job_type IN ('character_portrait', 'character_audio', 'character_animation')
    AND status = 'failed'
    AND last_error_code = 'UNKNOWN'
  RETURNING book_edition_id, character_key, payload
)
UPDATE character_media_bundles AS bundle
SET status = 'queued', updated_at = now()
FROM retried
WHERE bundle.book_edition_id = retried.book_edition_id
  AND bundle.character_key = retried.character_key
  AND bundle.bundle_version = retried.payload->>'bundle_version';
