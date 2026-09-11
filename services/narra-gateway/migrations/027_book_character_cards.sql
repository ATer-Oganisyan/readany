-- Хранение конвейера карточек персонажей (work order character-cards-pipeline, P0).
--
-- Четыре таблицы соответствуют четырём стадиям: детерминированный инвентарь
-- имён по всему тексту, фрагменты-evidence по персонажу, окна карточек по
-- главам и сами неизменяемые карточки. Публикация карточек инкрементальная и
-- не затрагивает book-markup-v3: v3 собирается из карточек после последнего
-- окна, поэтому TTS sidecar, чат и граф продолжают работать на прежнем
-- контракте.

CREATE TABLE book_name_inventory (
  run_id UUID PRIMARY KEY REFERENCES book_analysis_runs(id) ON DELETE CASCADE,
  inventory_version TEXT NOT NULL CHECK (length(inventory_version) BETWEEN 1 AND 80),
  normalized_text_hash CHAR(64) NOT NULL CHECK (normalized_text_hash ~ '^[0-9a-f]{64}$'),
  text_length INTEGER NOT NULL CHECK (text_length > 0),
  chapter_count INTEGER NOT NULL CHECK (chapter_count > 0),
  total_mentions INTEGER NOT NULL CHECK (total_mentions >= 0),
  roster_count INTEGER NOT NULL CHECK (roster_count >= 0),
  significant_count INTEGER NOT NULL CHECK (significant_count >= 0),
  document JSONB NOT NULL CHECK (
    jsonb_typeof(document) = 'object' AND
    jsonb_typeof(document->'candidates') = 'array'
  ),
  document_hash CHAR(64) NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (significant_count <= roster_count)
);

-- Текст фрагмента не дублируется: он читается byte-range'ем из нормализованного
-- текста в объектном хранилище по (start_offset, end_offset). Дублировать
-- цитату здесь значило бы завести второй источник истины для evidence.
CREATE TABLE book_character_fragments (
  run_id UUID NOT NULL REFERENCES book_analysis_runs(id) ON DELETE CASCADE,
  character_key TEXT NOT NULL CHECK (character_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  fragment_id TEXT NOT NULL CHECK (fragment_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  paragraph_index INTEGER NOT NULL CHECK (paragraph_index >= 0),
  chapter_index INTEGER NOT NULL CHECK (chapter_index >= -1),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
  mention_count INTEGER NOT NULL CHECK (mention_count > 0),
  PRIMARY KEY (run_id, fragment_id)
);

CREATE INDEX book_character_fragments_by_character
  ON book_character_fragments (run_id, character_key, start_offset);

CREATE TABLE book_card_windows (
  run_id UUID NOT NULL REFERENCES book_analysis_runs(id) ON DELETE CASCADE,
  window_index INTEGER NOT NULL CHECK (window_index >= 0),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
  chapter_indexes INTEGER[] NOT NULL CHECK (array_length(chapter_indexes, 1) > 0),
  priority_class TEXT NOT NULL CHECK (priority_class IN ('foreground', 'background')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, window_index)
);

CREATE INDEX book_card_windows_pending
  ON book_card_windows (run_id, window_index)
  WHERE status IN ('queued', 'running');

-- Карточка неизменяема: строка не обновляется, а новая версия появляется как
-- следующая card_revision. Ридер читает последнюю включённую ревизию, поэтому
-- откат — это выключение ревизии, а не правка данных.
CREATE TABLE book_character_cards (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES book_analysis_runs(id) ON DELETE CASCADE,
  book_edition_id UUID NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  character_key TEXT NOT NULL CHECK (character_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  card_revision INTEGER NOT NULL CHECK (card_revision > 0),
  window_index INTEGER NOT NULL CHECK (window_index >= 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  first_mention_text_offset INTEGER NOT NULL CHECK (first_mention_text_offset >= 0),
  window_start_offset INTEGER NOT NULL CHECK (window_start_offset >= 0),
  window_end_offset INTEGER NOT NULL CHECK (window_end_offset > window_start_offset),
  document JSONB NOT NULL CHECK (
    jsonb_typeof(document) = 'object' AND
    document->>'contractVersion' = 'character-card-v1'
  ),
  document_hash CHAR(64) NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  fragment_set_hash CHAR(64) NOT NULL CHECK (fragment_set_hash ~ '^[0-9a-f]{64}$'),
  normalized_text_hash CHAR(64) NOT NULL CHECK (normalized_text_hash ~ '^[0-9a-f]{64}$'),
  prompt_version TEXT NOT NULL CHECK (length(prompt_version) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, character_key, card_revision),
  CHECK (first_mention_text_offset < window_end_offset)
);

-- Одна включённая ревизия на персонажа в прогоне: ридер не должен выбирать
-- между двумя карточками одного героя.
CREATE UNIQUE INDEX book_character_cards_enabled_revision
  ON book_character_cards (run_id, character_key)
  WHERE enabled;

CREATE INDEX book_character_cards_by_edition
  ON book_character_cards (book_edition_id, first_mention_text_offset)
  WHERE enabled;
