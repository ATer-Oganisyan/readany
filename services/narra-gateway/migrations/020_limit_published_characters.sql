CREATE TEMP TABLE published_character_frequency_rank ON COMMIT DROP AS
WITH published_v3 AS (
  SELECT markup.id AS markup_version_id,
         markup.book_edition_id,
         publication.run_id
  FROM book_markup_versions AS markup
  JOIN LATERAL (
    SELECT value.run_id
    FROM book_analysis_publications AS value
    WHERE value.book_edition_id = markup.book_edition_id
      AND value.channel = 'shadow'
      AND value.content_hash = markup.input_hash
    ORDER BY value.published_at DESC, value.id DESC
    LIMIT 1
  ) AS publication ON true
  WHERE markup.status = 'published'
    AND markup.analysis_version = 'book-markup-v3'
), scores AS (
  SELECT publication.markup_version_id,
         publication.book_edition_id,
         character.character_key,
         character.first_appearance_text_offset,
         count(DISTINCT ROW(
           observation.evidence_start_offset,
           observation.evidence_end_offset
         )) FILTER (
           WHERE observation.observation_type = 'character_mention'
         )::integer AS mention_count,
         count(DISTINCT ROW(
           observation.evidence_start_offset,
           observation.evidence_end_offset
         )) FILTER (
           WHERE observation.id IS NOT NULL
         )::integer AS evidence_count
  FROM published_v3 AS publication
  JOIN book_characters AS character
    ON character.markup_version_id = publication.markup_version_id
  LEFT JOIN book_analysis_entities AS entity
    ON entity.run_id = publication.run_id
   AND entity.entity_key = character.character_key
   AND entity.entity_kind = 'character'
   AND entity.resolution_status = 'confirmed'
  LEFT JOIN book_analysis_entity_evidence AS link
    ON link.run_id = publication.run_id
   AND link.entity_id = entity.id
  LEFT JOIN book_analysis_observations AS observation
    ON observation.run_id = publication.run_id
   AND observation.id = link.observation_id
  GROUP BY publication.markup_version_id,
           publication.book_edition_id,
           character.character_key,
           character.first_appearance_text_offset
)
SELECT scores.*,
       row_number() OVER (
         PARTITION BY scores.markup_version_id
         ORDER BY scores.mention_count DESC,
                  scores.evidence_count DESC,
                  scores.first_appearance_text_offset,
                  scores.character_key
       )::integer AS prominence_rank
FROM scores;

CREATE UNIQUE INDEX published_character_frequency_rank_key
  ON published_character_frequency_rank (markup_version_id, character_key);

UPDATE book_characters AS character
SET sort_order = ranking.prominence_rank - 1,
    data = jsonb_set(
      jsonb_set(
        jsonb_set(
          character.data,
          '{mentionCount}',
          to_jsonb(ranking.mention_count),
          true
        ),
        '{evidenceCount}',
        to_jsonb(ranking.evidence_count),
        true
      ),
      '{prominenceRank}',
      to_jsonb(ranking.prominence_rank),
      true
    )
FROM published_character_frequency_rank AS ranking
WHERE character.markup_version_id = ranking.markup_version_id
  AND character.character_key = ranking.character_key
  AND ranking.prominence_rank <= 20;

UPDATE generation_jobs AS job
SET status = 'failed',
    last_error_code = 'CHARACTER_NOT_SELECTED',
    locked_at = NULL,
    locked_by = NULL,
    lease_token = NULL,
    updated_at = now()
FROM published_character_frequency_rank AS ranking
WHERE ranking.prominence_rank > 20
  AND job.book_edition_id = ranking.book_edition_id
  AND job.character_key = ranking.character_key
  AND job.job_type IN (
    'character_bundle',
    'character_portrait',
    'character_audio',
    'character_animation'
  )
  AND job.status IN ('queued', 'running');

UPDATE character_media_bundles AS bundle
SET status = 'failed', updated_at = now()
FROM published_character_frequency_rank AS ranking
WHERE ranking.prominence_rank > 20
  AND bundle.book_edition_id = ranking.book_edition_id
  AND bundle.character_key = ranking.character_key
  AND bundle.status IN ('queued', 'running');

DELETE FROM book_characters AS character
USING published_character_frequency_rank AS ranking
WHERE ranking.prominence_rank > 20
  AND character.markup_version_id = ranking.markup_version_id
  AND character.character_key = ranking.character_key;
