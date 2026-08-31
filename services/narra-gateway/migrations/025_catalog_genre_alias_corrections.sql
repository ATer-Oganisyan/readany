DELETE FROM book_edition_genres AS genre
USING book_editions AS edition
WHERE genre.book_edition_id = edition.id
  AND edition.scope = 'catalog'
  AND edition.catalog_key IN (
    'narra-ru-top100-vojna-i-mir-tolstoj-f0777e32',
    'narra-ru-top100-bratya-karamazovy-ddb71ca8'
  );

WITH catalog_key_aliases(catalog_key, genres) AS (
  VALUES
    ('narra-ru-top100-vojna-i-mir-tolstoj-f0777e32', ARRAY['historical-fiction', 'literary-fiction']::text[]),
    ('narra-ru-top100-bratya-karamazovy-ddb71ca8', ARRAY['literary-fiction']::text[])
),
target_editions AS (
  SELECT edition.id AS book_edition_id, alias.genres
  FROM book_editions AS edition
  JOIN catalog_key_aliases AS alias ON alias.catalog_key = edition.catalog_key
  WHERE edition.scope = 'catalog'
)
INSERT INTO book_edition_genres (book_edition_id, genre, position)
SELECT
  edition.book_edition_id,
  genre.value,
  genre.ordinality::smallint
FROM target_editions AS edition
CROSS JOIN LATERAL unnest(edition.genres) WITH ORDINALITY AS genre(value, ordinality);
